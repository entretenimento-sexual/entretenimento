import { describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { PendingReadAdmission, pendingReadDelay } from './pending-read-admission';

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
