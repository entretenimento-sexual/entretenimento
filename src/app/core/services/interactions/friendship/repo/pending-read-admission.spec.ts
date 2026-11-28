import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { PendingReadAdmission, pendingReadDelay, type PendingReadAdmissionDecision, type PendingReadLease } from './pending-read-admission';

describe('PendingReadAdmission', () => {
  it('preserva margem de dez leituras por janela móvel de 65 segundos', () => {
    const now=700_000;
    expect(pendingReadDelay(Array(9).fill(now-1_000),now)).toBe(0);
    expect(pendingReadDelay(Array(10).fill(now-1_000),now)).toBe(64_000);
    expect(pendingReadDelay(Array(10).fill(now-65_000),now)).toBe(0);
  });
  it('preserva também o orçamento sustentado de cinquenta leituras', () => {
    const now=700_000;
    const starts=Array.from({length:50},(_,i)=>now-500_000+i*8_000);
    expect(pendingReadDelay(starts,now)).toBe(105_000);
    expect(pendingReadDelay(starts.slice(1),now)).toBe(0);
  });
  it('continua usando autoridade backend quando Web Locks não está disponível', async () => {
    await expect(firstValueFrom(new PendingReadAdmission().wait$('a',()=>true,()=>{}))).resolves.toBeUndefined();
  });
  it('não emite permissão após revogação mesmo no fallback', () => {
    let emitted=false;
    const sub=new PendingReadAdmission().wait$('a',()=>false,()=>{}).subscribe(()=>emitted=true);
    expect(emitted).toBe(false);
    expect(sub.closed).toBe(true);
  });
});

describe('PendingReadAdmission diagnostic decisions', () => {
  const documentFor = (options: { noLocks?: boolean; digestFails?: boolean; lockFails?: boolean; storageFails?: boolean } = {}) => {
    const storage = new Map<string, string>();
    let nextId = 0;
    return { defaultView: {
      navigator: { onLine: true, locks: options.noLocks ? undefined : {
        request: async (_name: string, optionsOrCallback: unknown, callback?: () => unknown) => {
          if (options.lockFails) throw new Error('lock denied');
          return (typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!)();
        }
      }},
      crypto: { randomUUID: () => '00000000-0000-4000-8000-'+String(++nextId).padStart(12,'0'), subtle: { digest: async () => {
        if (options.digestFails) throw new Error('digest denied');
        return new Uint8Array(32).buffer;
      }}},
      localStorage: {
        getItem: (key: string) => {
          if (options.storageFails) throw new Error('storage denied');
          return storage.get(key) ?? null;
        },
        setItem: (key: string, value: string) => storage.set(key, value)
      }
    }} as unknown as Document;
  };
  it.each([
    [{}, 'reserved'], [{noLocks:true}, 'no-locks'],
    [{digestFails:true}, 'digest-failed'], [{lockFails:true}, 'lock-failed'],
    [{storageFails:true}, 'storage-failed']
  ] as const)('reports the actual decision for %j', async (options, expected) => {
    const decisions: PendingReadAdmissionDecision[] = [];
    await firstValueFrom(new PendingReadAdmission(documentFor(options)).wait$('a',()=>true,()=>{},decision=>decisions.push(decision)));
    expect(decisions).toEqual([expected]);
  });
  it('retains distinct live numerical markers and settles only the matching lease', async () => {
    const doc = documentFor();
    const storage = doc.defaultView!.localStorage;
    const key = 'friendship.pending-read-admission.v1';
    const uidKey = '0'.repeat(64);
    const base = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(base);
    try {
      const leases: PendingReadLease[] = [];
      const admission = new PendingReadAdmission(doc);
      for (let i=0;i<10;i++) {
        await firstValueFrom(admission.wait$('a',()=>true,()=>{},()=>{},lease=>leases.push(lease)));
      }
      const entries = () => JSON.parse(storage.getItem(key)!)[uidKey] as number[];
      expect(leases).toHaveLength(10);
      expect(new Set(entries()).size).toBe(10);
      expect(pendingReadDelay(entries(),base+65_000)).toBeGreaterThan(0);
      clock.mockReturnValue(base+7_000);
      leases[0].settleSuccess();
      await Promise.resolve();
      expect(entries().filter(value=>value===base+7_000)).toHaveLength(1);
      expect(entries()).toHaveLength(10);
      expect(pendingReadDelay(entries(),base+65_000)).toBe(7_000);
      // Old documents may append ordinary numeric timestamps under the v1 lock.
      storage.setItem(key,JSON.stringify({[uidKey]:[...entries(),base+8_000]}));
      clock.mockReturnValue(base+9_000);
      leases[0].settleSuccess();
      await Promise.resolve();
      expect(entries().filter(value=>value===base+7_000)).toHaveLength(1);
      expect(entries()).toContain(base+8_000);
    } finally { clock.mockRestore(); }
  });
  it('retains an uncertain marker after a missing settlement and expires it finitely', async () => {
    const doc=documentFor();
    const base=1_000_000;
    const clock=vi.spyOn(Date,'now').mockReturnValue(base);
    try {
      const admission=new PendingReadAdmission(doc);
      for(let i=0;i<10;i++) await firstValueFrom(admission.wait$('a',()=>true,()=>{}));
      const values=JSON.parse(doc.defaultView!.localStorage.getItem('friendship.pending-read-admission.v1')!)['0'.repeat(64)] as number[];
      expect(pendingReadDelay(values,base+194_999)).toBeGreaterThan(0);
      expect(pendingReadDelay(values,base+195_009)).toBe(0);
      expect(pendingReadDelay(values,base+735_009)).toBe(0);
    } finally { clock.mockRestore(); }
  });
  it('rechecks a shared lease without repeating the logical wait or starting early', async () => {
    vi.useFakeTimers();
    const base = 1_000_000;
    vi.setSystemTime(base);
    const doc = documentFor();
    const a = new PendingReadAdmission(doc);
    const b = new PendingReadAdmission(doc);
    const leases: PendingReadLease[] = [];
    const waits = vi.fn();
    const decisions: PendingReadAdmissionDecision[] = [];
    let admitted = false;
    try {
      for (let i=0;i<10;i++) {
        await firstValueFrom(a.wait$('a',()=>true,()=>{},()=>{},lease=>leases.push(lease)));
      }
      await vi.advanceTimersByTimeAsync(10_000);
      const queued = firstValueFrom(b.wait$('a',()=>true,waits,decision=>decisions.push(decision)))
        .then(()=>{ admitted = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(decisions).toEqual(['waiting']);
      expect(admitted).toBe(false);
      // A successful response arrives after the second observer was queued.
      leases[0].settleSuccess();
      await vi.advanceTimersByTimeAsync(64_999);
      expect(admitted).toBe(false);
      expect(waits).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await queued;
      expect(admitted).toBe(true);
      expect(decisions).toEqual(['waiting','reserved']);
    } finally { vi.useRealTimers(); }
  });
  it('does not report an admission or fallback for a revoked session', () => {
    const decisions: PendingReadAdmissionDecision[] = [];
    new PendingReadAdmission().wait$('a',()=>false,()=>{},decision=>decisions.push(decision)).subscribe();
    expect(decisions).toEqual([]);
  });
});
