import { Observable, Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { watchPublicMediaAfterOwnerAuthorization$ } from './public-video-playback-exposure.service';

describe('watchPublicMediaAfterOwnerAuthorization$', () => {
  it('não lê foto nem vídeo com perfil suspenso ou em exclusão pendente', () => {
    const profile$ = new Subject<boolean>();
    const watchMedia = vi.fn(() => of(true));
    const received: boolean[] = [];
    const subscription = watchPublicMediaAfterOwnerAuthorization$(
      profile$, watchMedia
    ).subscribe((allowed) => received.push(allowed));

    profile$.next(false);
    expect(received).toEqual([false]);
    expect(watchMedia).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('encerra uma escuta negada e recria outra na reativação, sem refresh manual', () => {
    const profile$ = new Subject<boolean>();
    const firstMedia$ = new Subject<boolean>();
    const secondMedia$ = new Subject<boolean>();
    const watchMedia = vi.fn()
      .mockImplementationOnce(() => firstMedia$.asObservable())
      .mockImplementationOnce(() => secondMedia$.asObservable());
    const seen: boolean[] = [];
    const subscription = watchPublicMediaAfterOwnerAuthorization$(
      profile$, watchMedia
    ).subscribe((allowed) => seen.push(allowed));

    profile$.next(true);
    firstMedia$.next(true);
    expect(seen).toEqual([true]);

    profile$.next(false);
    expect(seen).toEqual([true, false]);
    expect(firstMedia$.observed).toBe(false);
    firstMedia$.next(true); // resposta atrasada da autorização revogada
    expect(seen).toEqual([true, false]);

    profile$.next(true);
    expect(watchMedia).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([true, false]); // aguardando confirmação atual
    secondMedia$.next(true);
    expect(seen).toEqual([true, false, true]);
    subscription.unsubscribe();
  });

  it('recupera depois de permission-denied do listener anterior', () => {
    const profile$ = new Subject<boolean>();
    const broken$ = new Subject<boolean>();
    const restored$ = new Subject<boolean>();
    const observe = vi.fn()
      .mockImplementationOnce(() => broken$.asObservable())
      .mockImplementationOnce(() => restored$.asObservable());
    const seen: boolean[] = [];
    const subscription = watchPublicMediaAfterOwnerAuthorization$(
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
    const subscription = watchPublicMediaAfterOwnerAuthorization$(
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
