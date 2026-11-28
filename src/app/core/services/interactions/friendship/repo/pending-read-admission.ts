import { EMPTY, Observable, defer, from, of, switchMap, timer, throwError } from 'rxjs';

// Mirrors (does not replace) the backend's 20 units/60s and 100/10min.
// A request of 60 items costs 2 units. Rolling windows with a margin are
// conservative relative to the authoritative fixed windows.
const BURST_WINDOW_MS = 65_000;
const SUSTAINED_WINDOW_MS = 605_000;
const MAX_WAIT_MS = 70_000;
// Bounded uncertainty policy, not a guaranteed server processing deadline.
const UNCERTAINTY_MS = 130_000;
const RECHECK_MS = 1_000;
const STORAGE_KEY = 'friendship.pending-read-admission.v1';
const LOCK_NAME = 'friendship.pending-read-admission.v1';
const LEASE_KEY = 'friendship.pending-read-admission.leases.v1';
const MAX_ACCOUNTS = 128;
type Ledger = Record<string, number[]>;
type LeaseIndex = Record<string, { key: string; marker: number }>;

export interface PendingReadLease {
  /** Settle only after successful resolution of the original callable Promise. */
  settleSuccess(): void;
}

export function pendingReadDelay(starts: readonly number[], now: number): number {
  const live = starts.filter(value => Number.isFinite(value) && value > now - SUSTAINED_WINDOW_MS)
    .sort((a,b) => a-b);
  const burst = live.filter(value => value > now - BURST_WINDOW_MS);
  return Math.max(0,
    burst.length >= 10 ? burst[burst.length-10] + BURST_WINDOW_MS - now : 0,
    live.length >= 50 ? live[live.length-50] + SUSTAINED_WINDOW_MS - now : 0);
}

function readLedger(storage: Storage, now: number): Ledger {
  const raw = storage.getItem(STORAGE_KEY);
  const ledger: Ledger = Object.create(null);
  if (!raw) return ledger;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid admission ledger');
  for (const [key, entries] of Object.entries(parsed)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !Array.isArray(entries)) continue;
    const live = entries.filter((value): value is number => typeof value === 'number' &&
      Number.isFinite(value) && value > now-SUSTAINED_WINDOW_MS && value <= now+SUSTAINED_WINDOW_MS);
    if (live.length) ledger[key] = live.sort((a,b)=>a-b).slice(-50);
  }
  return ledger;
}

// v1 remains the shared numerical ledger. Old documents count future markers
// with the same lock and cannot create additional quota by ignoring the index.
// The separate index is only a fence for shortening a particular marker.
function readLeaseIndex(storage: Storage, ledger: Ledger): LeaseIndex {
  const index: LeaseIndex = Object.create(null);
  const raw = storage.getItem(LEASE_KEY);
  if (!raw) return index;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid lease index');
  for (const [id, value] of Object.entries(parsed)) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !value || typeof value !== 'object') continue;
    const { key, marker } = value as { key?: unknown; marker?: unknown };
    if (typeof key !== 'string' || typeof marker !== 'number' ||
        !/^[a-f0-9]{64}$/.test(key) || !Number.isFinite(marker)) continue;
    if (ledger[key]?.filter(entry => entry === marker).length === 1) index[id] = { key, marker };
  }
  return index;
}

export type PendingReadAdmissionDecision =
  | 'reserved' | 'waiting' | 'no-window' | 'no-locks' | 'no-crypto'
  | 'digest-failed' | 'storage-failed' | 'lock-failed';

export interface PendingReadLedgerEvidence {
  readonly live: number;
  readonly burst: number;
  readonly future: number;
  readonly delay: number;
}
interface Admission {
  readonly delay: number;
  readonly mode: 'reserved' | 'fallback' | 'waiting';
  readonly reason?: 'storage-failed' | 'lock-failed';
  readonly lease?: PendingReadLease;
  readonly evidence?: PendingReadLedgerEvidence;
}

/**
 * Advisory, same-origin admission only. Never shares results, credentials,
 * revision values or authorization. The lock covers only synchronous metadata
 * mutation, not HTTP. Unsupported/blocked storage falls back to backend authority.
 */
export class PendingReadAdmission {
  constructor(private readonly document?: Document) {}

  wait$(uid: string, isCurrent: () => boolean, onWait: () => void,
    onDecision: (decision: PendingReadAdmissionDecision) => void = () => {},
    onReservation: (lease: PendingReadLease) => void = () => {},
    onLedger: (evidence: PendingReadLedgerEvidence) => void = () => {}): Observable<void> {
    return defer(() => {
      const view = this.document?.defaultView;
      const locks = view?.navigator.locks;
      const subtle = view?.crypto?.subtle;
      const fallback = (reason: PendingReadAdmissionDecision): Observable<void> => {
        if (!isCurrent()) return EMPTY;
        onDecision(reason);
        return of(void 0);
      };
      if (!view) return fallback('no-window');
      if (!locks) return fallback('no-locks');
      if (!subtle) return fallback('no-crypto');
      const started = Date.now();
      let waitingReported = false;
      const key$ = from(subtle.digest('SHA-256', new TextEncoder().encode(uid))
        .then(bytes => Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join(''))
        .catch(()=>null));
      const createLease = (id: string, key: string, marker: number): PendingReadLease => ({
        settleSuccess: () => {
          // No subscription or session reference: only hashed-account quota
          // metadata is updated, even if the original consumer was revoked.
          void Promise.resolve().then(() => locks.request(LOCK_NAME, () => {
            try {
              const now = Date.now();
              const storage = view.localStorage;
              const ledger = readLedger(storage, now);
              const index = readLeaseIndex(storage, ledger);
              const entry = index[id];
              if (!entry || entry.key !== key || entry.marker !== marker) return;
              const starts = ledger[key];
              if (!starts || starts.filter(value => value === marker).length !== 1) return;
              delete index[id];
              // Fence first. A partial write can leave a conservative marker,
              // but cannot shorten a later reservation or manufacture quota.
              storage.setItem(LEASE_KEY, JSON.stringify(index));
              ledger[key] = starts.map(value => value === marker
                ? Math.max(now, marker - UNCERTAINTY_MS) : value);
              storage.setItem(STORAGE_KEY, JSON.stringify(ledger));
            } catch { /* advisory metadata only; retain existing charge */ }
          })).catch(() => {});
        }
      });
      const reserve = (key: string): Observable<Admission> => new Observable(sink => {
        const controller = new AbortController();
        // The request can be cancelled before entering the critical section.
        // Once admitted, charge conservatively even if transport never starts.
        locks.request(LOCK_NAME, { signal: controller.signal }, (): Admission => {
          if (sink.closed || !isCurrent()) return {delay:0,mode:'fallback'};
          if (!view.navigator.onLine) return {delay:1_000,mode:'waiting'};
          try {
            const now = Date.now();
            const storage = view.localStorage;
            const ledger = readLedger(storage, now);
            const starts = ledger[key] ?? [];
            const delay = pendingReadDelay(starts, now);
            const evidence: PendingReadLedgerEvidence = {live:starts.length,
              burst:starts.filter(value=>value>now-BURST_WINDOW_MS).length,
              future:starts.filter(value=>value>now).length,delay};
            if (delay > 0) return {delay,mode:'waiting',evidence};
            if (!(key in ledger) && Object.keys(ledger).length >= MAX_ACCOUNTS) {
              // Do not evict recent accounts and manufacture new capacity.
              return {delay:MAX_WAIT_MS+1,mode:'waiting',evidence};
            }
            // Unique within the live numerical ledger; old tabs continue to
            // observe the charge. Never evict a live entry to reserve capacity.
            let marker = now + UNCERTAINTY_MS;
            while (starts.includes(marker)) marker++;
            ledger[key] = [...starts, marker];
            storage.setItem(STORAGE_KEY, JSON.stringify(ledger));
            // The authoritative local charge is already persisted. A missing
            // or failed index must not retry admission or shorten the marker.
            try {
              const id = view.crypto.randomUUID();
              const index = readLeaseIndex(storage, ledger);
              if (!(id in index)) {
                index[id] = {key, marker};
                storage.setItem(LEASE_KEY, JSON.stringify(index));
                return {delay:0,mode:'reserved',lease:createLease(id,key,marker),evidence};
              }
            } catch { /* finite conservative charge remains in the v1 ledger */ }
            return {delay:0,mode:'reserved',evidence};
          } catch {
            // Storage/security failures are not permission decisions.
            return {delay:0,mode:'fallback',reason:'storage-failed'};
          }
        }).then(result => {
          if (!sink.closed) { sink.next(result); sink.complete(); }
        }, () => {
          if (!sink.closed) { sink.next({delay:0,mode:'fallback',reason:'lock-failed'}); sink.complete(); }
        });
        return () => controller.abort();
      });
      const attempt = (key: string): Observable<void> => defer(() => {
        if (!isCurrent()) return EMPTY;
        return reserve(key).pipe(switchMap(result => {
          if (!isCurrent()) return EMPTY;
          if (result.mode === 'fallback') return fallback(result.reason ?? 'lock-failed');
          if (result.evidence && (result.delay === 0 || !waitingReported)) onLedger(result.evidence);
          if (result.delay === 0) {
            onDecision(result.mode);
            if (result.lease) onReservation(result.lease);
            return of(void 0);
          }
          // A timer recheck is not a new operation or new quota wait.
          if (!waitingReported) {
            waitingReported = true;
            onDecision('waiting');
            onWait();
          }
          const remaining = MAX_WAIT_MS - (Date.now()-started);
          // A response in another tab may shorten a marker before its
          // uncertainty horizon. Recheck locally without issuing HTTP.
          if (remaining <= 0) {
            return throwError(()=>Object.assign(new Error('Aguarde a renovação do limite de consultas.'), {
              code:'functions/resource-exhausted',
              details:{retryAfterMs:result.delay}
            }));
          }
          return timer(Math.max(1,Math.min(result.delay,RECHECK_MS,remaining))).pipe(switchMap(()=>attempt(key)));
        }));
      });
      return key$.pipe(switchMap(key=>key ? attempt(key) : fallback('digest-failed')));
    });
  }
}
