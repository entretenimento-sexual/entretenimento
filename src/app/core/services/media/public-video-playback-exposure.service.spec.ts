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

  it('recupera depois de permission-denied do listener anterior', () => {
    const profile$ = new Subject<boolean>();
    const broken$ = new Subject<boolean>();
    const restored$ = new Subject<boolean>();
    const observe = vi.fn()
      .mockImplementationOnce(() => broken$.asObservable())
      .mockImplementationOnce(() => restored$.asObservable());
    const seen: boolean[] = [];
    const subscription = watchMediaAfterProfileAvailability$(
      profile$, observe
    ).subscribe((allowed) => seen.push(allowed));

    profile$.next(true);
    broken$.error({ code: 'permission-denied' });
    expect(seen).toEqual([false]);

    profile$.next(false);
    profile$.next(true);
    expect(observe).toHaveBeenCalledTimes(2);
    restored$.next(true);
    expect(seen).toEqual([false, true]);
    subscription.unsubscribe();
  });

  it('não reautoriza a partir de um resultado anterior após novo bloqueio', () => {
    const profile$ = new Subject<boolean>();
    const first$ = new Subject<boolean>();
    const second$ = new Subject<boolean>();
    const observe = vi.fn()
      .mockImplementationOnce(() => first$.asObservable())
      .mockImplementationOnce(() => second$.asObservable());
    const seen: boolean[] = [];
    const subscription = watchMediaAfterProfileAvailability$(
      profile$, observe
    ).subscribe(v => seen.push(v));

    profile$.next(true);
    first$.next(true);
    profile$.next(false);
    first$.next(true);
    expect(seen).toEqual([true, false]);

    profile$.next(true);
    second$.next(false); // mídia em quarentena/excluída
    expect(seen).toEqual([true, false]);
    expect(observe).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });
});
