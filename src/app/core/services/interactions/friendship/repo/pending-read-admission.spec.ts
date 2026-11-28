import { describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { PendingReadAdmission, pendingReadDelay, type PendingReadAdmissionDecision } from './pending-read-admission';

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
    return { defaultView: {
      navigator: { onLine: true, locks: options.noLocks ? undefined : {
        request: async (_name: string, _options: unknown, callback: () => unknown) => {
          if (options.lockFails) throw new Error('lock denied');
          return callback();
        }
      }},
      crypto: { subtle: { digest: async () => {
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
  it('does not report an admission or fallback for a revoked session', () => {
    const decisions: PendingReadAdmissionDecision[] = [];
    new PendingReadAdmission().wait$('a',()=>false,()=>{},decision=>decisions.push(decision)).subscribe();
    expect(decisions).toEqual([]);
  });
});
