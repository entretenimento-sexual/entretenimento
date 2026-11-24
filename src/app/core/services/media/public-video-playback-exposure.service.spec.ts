import { Observable, Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { watchMediaAfterProfileAvailability$ } from './public-video-playback-exposure.service';

describe('watchMediaAfterProfileAvailability$', () => {
  it('encerra listener na exclusão e readquire permissão após cancelamento', () => {
    const allowed$ = new Subject<boolean>();
    const firstMedia$ = new Subject<boolean>();
    const restoredMedia$ = new Subject<boolean>();
    const watchMedia = vi.fn()
      .mockImplementationOnce(() => firstMedia$.asObservable())
      .mockImplementationOnce(() => restoredMedia$.asObservable());
    const seen: boolean[] = [];
    const subscription = watchMediaAfterProfileAvailability$(
      allowed$, watchMedia
    ).subscribe(value => seen.push(value));

    allowed$.next(true);
    firstMedia$.next(true);
    expect(seen).toEqual([true]);

    allowed$.next(false);
    expect(seen).toEqual([true, false]);
    expect(firstMedia$.observed).toBe(false);

    // Mesmo que a escuta anterior tenha morrido com permission-denied,
    // a restauração exige uma NOVA subscrição para a mídia atual.
    allowed$.next(true);
    expect(watchMedia).toHaveBeenCalledTimes(2);
    restoredMedia$.next(true);
    expect(seen).toEqual([true, false, true]);
    subscription.unsubscribe();
  });

  it('nunca consulta mídia quando o perfil está indisponível', () => {
    const watchMedia = vi.fn(() => of(true));
    const seen: boolean[] = [];
    watchMediaAfterProfileAvailability$(of(false), watchMedia)
      .subscribe(value => seen.push(value));
    expect(seen).toEqual([false]);
    expect(watchMedia).not.toHaveBeenCalled();
  });

  it('permanece fail-closed quando nova leitura da mídia é negada', () => {
    const denied$ = new Observable<boolean>(subscriber =>
      subscriber.error(new Error('permission-denied'))
    );
    const seen: boolean[] = [];
    watchMediaAfterProfileAvailability$(of(true), () => denied$)
      .subscribe(value => seen.push(value));
    expect(seen).toEqual([false]);
  });
});
