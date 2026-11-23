import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { watchBilateralProfileVisibility$ } from './public-profile-visibility.service';

describe('watchBilateralProfileVisibility$', () => {
  it('desmonta o perfil no bloqueio e cria nova assinatura após desbloqueio', () => {
    const bilateral$ = new Subject<boolean>();
    const first$ = new Subject<boolean>();
    const second$ = new Subject<boolean>();
    const watchOwner = vi.fn()
      .mockImplementationOnce(() => first$.asObservable())
      .mockImplementationOnce(() => second$.asObservable());
    const seen: boolean[] = [];
    const sub = watchBilateralProfileVisibility$(
      bilateral$, watchOwner
    ).subscribe((allowed) => seen.push(allowed));

    bilateral$.next(true);
    first$.next(true);
    expect(seen).toEqual([true]);
    bilateral$.next(false);
    expect(seen).toEqual([true, false]);
    expect(first$.observed).toBe(false);

    bilateral$.next(true);
    expect(watchOwner).toHaveBeenCalledTimes(2);
    second$.next(true);
    expect(seen).toEqual([true, false, true]);

    sub.unsubscribe();
  });

  it('não consulta a projeção pública quando o bloqueio está ativo', () => {
    const watchOwner = vi.fn(() => of(true));
    const received: boolean[] = [];
    const sub = watchBilateralProfileVisibility$(of(false), watchOwner)
      .subscribe((allowed) => received.push(allowed));
    expect(received).toEqual([false]);
    expect(watchOwner).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
});
