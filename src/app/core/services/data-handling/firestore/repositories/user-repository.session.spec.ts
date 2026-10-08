import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import { UserRepositoryService } from './user-repository.service';

function user(uid: string): IUserDados {
  return {
    uid,
    email: uid + '@example.test',
    nickname: uid,
    role: 'basic',
    isSubscriber: false,
  } as IUserDados;
}

function harness() {
  const auth = {
    currentAuthUser: { uid: 'user-a' } as { uid: string } | null,
    isTerminatingSnapshot: false,
  };
  const once$ = new Subject<IUserDados | null>();
  const watch$ = new Subject<IUserDados | null>();
  const cache = {
    getCachedUser$: vi.fn(() => of(undefined)),
    upsertUser: vi.fn(),
  };
  const read = {
    getUserOnce$: vi.fn(() => once$.asObservable()),
    watchUser$: vi.fn(() => watch$.asObservable()),
  };
  const store = { select: vi.fn(() => of(null)) };
  const errors = { handleFirestoreErrorAndReturnNull: vi.fn(() => of(null)) };
  const repo = new UserRepositoryService(
    {} as never,
    store as never,
    errors as never,
    read as never,
    cache as never,
    auth as never
  );
  return { repo, auth, once$, watch$, cache, store };
}

describe('UserRepositoryService - cache privado vinculado à sessão', () => {
  it('não repovoa cache com resultado one-shot de A após troca para B', () => {
    const h = harness();
    const sub = h.repo.getUser$('user-a').subscribe();

    h.auth.currentAuthUser = { uid: 'user-b' };
    h.once$.next(user('user-a'));

    expect(h.cache.upsertUser).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('não repovoa cache com snapshot realtime antigo após logout', () => {
    const h = harness();
    const sub = h.repo.watchUser$('user-a').subscribe();

    h.auth.isTerminatingSnapshot = true;
    h.watch$.next(user('user-a'));

    expect(h.cache.upsertUser).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('mantém o cache de leitura privada quando o UID ainda é o mesmo', () => {
    const h = harness();
    const sub = h.repo.getUser$('user-a').subscribe();
    h.once$.next(user('user-a'));

    expect(h.cache.upsertUser).toHaveBeenCalledOnce();
    expect(h.cache.upsertUser).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-a' }));
    sub.unsubscribe();
  });

  it('não escreve documento com UID divergente mesmo em sessão válida', () => {
    const h = harness();
    const sub = h.repo.watchUser$('user-a').subscribe();
    h.watch$.next(user('user-b'));
    expect(h.cache.upsertUser).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
});
