import { EMPTY, Observable, defer, from, of, switchMap, timer, throwError } from 'rxjs';

// Mirrors (does not replace) the backend's 20 units/60s and 100/10min.
// A request of 60 items costs 2 units. Rolling windows with a margin are
// conservative relative to the authoritative fixed windows.
const BURST_WINDOW_MS = 65_000;
const SUSTAINED_WINDOW_MS = 605_000;
const MAX_WAIT_MS = 70_000;
const STORAGE_KEY = 'friendship.pending-read-admission.v1';
const LOCK_NAME = 'friendship.pending-read-admission.v1';
const MAX_ACCOUNTS = 128;
type Ledger = Record<string, number[]>;

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

interface Admission { readonly delay: number; readonly mode: 'reserved' | 'fallback' | 'waiting' }

/**
 * Advisory, same-origin admission only. Never shares results, credentials,
 * revision values or authorization. The lock covers only synchronous metadata
 * mutation, not HTTP. Unsupported/blocked storage falls back to backend authority.
 */
export class PendingReadAdmission {
  constructor(private readonly document?: Document) {}

  wait$(uid: string, isCurrent: () => boolean, onWait: () => void): Observable<void> {
    return defer(() => {
      const view = this.document?.defaultView;
      const locks = view?.navigator.locks;
      const subtle = view?.crypto.subtle;
      if (!view || !locks || !subtle) return isCurrent() ? of(void 0) : EMPTY;
      const started = Date.now();
      const key$ = from(subtle.digest('SHA-256', new TextEncoder().encode(uid))
        .then(bytes => Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join(''))
        .catch(()=>null));
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
            if (delay > 0) return {delay,mode:'waiting'};
            if (!(key in ledger) && Object.keys(ledger).length >= MAX_ACCOUNTS) {
              // Do not evict recent accounts and manufacture new capacity.
              return {delay:MAX_WAIT_MS+1,mode:'waiting'};
            }
            ledger[key] = [...starts, now];
            storage.setItem(STORAGE_KEY, JSON.stringify(ledger));
            return {delay:0,mode:'reserved'};
          } catch {
            // Storage/security failures are not permission decisions.
            return {delay:0,mode:'fallback'};
          }
        }).then(result => {
          if (!sink.closed) { sink.next(result); sink.complete(); }
        }, () => {
          if (!sink.closed) { sink.next({delay:0,mode:'fallback'}); sink.complete(); }
        });
        return () => controller.abort();
      });
      const attempt = (key: string): Observable<void> => defer(() => {
        if (!isCurrent()) return EMPTY;
        return reserve(key).pipe(switchMap(result => {
          if (!isCurrent()) return EMPTY;
          if (result.delay === 0) return of(void 0);
          onWait();
          if (Date.now()-started+result.delay > MAX_WAIT_MS) {
            return throwError(()=>Object.assign(new Error('Aguarde a renovação do limite de consultas.'), {
              code:'functions/resource-exhausted',
              details:{retryAfterMs:result.delay}
            }));
          }
          return timer(Math.max(1,result.delay)).pipe(switchMap(()=>attempt(key)));
        }));
      });
      return key$.pipe(switchMap(key=>key ? attempt(key) : isCurrent() ? of(void 0) : EMPTY));
    });
  }
}
