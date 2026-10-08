import { Actions } from '@ngrx/effects';
import type { Action } from '@ngrx/store';
import { Subject, type Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { observeUserChanges, loadUsers, setCurrentUser, addUserToState } from '../../actions/actions.user/user.actions';
import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserEffects } from './user.effects';

function user(uid: string): IUserDados {
  return {
    uid,
    nickname: uid,
    email: uid + '@example.test',
    role: 'basic',
    isSubscriber: false,
    profileCompleted: true,
  } as IUserDados;
}

function harness() {
  const actions$ = new Subject<Action>();
  let activeUid: string | null = 'user-a';
  const streamA$ = new Subject<IUserDados | null>();
  const streamB$ = new Subject<IUserDados | null>();
  const listA$ = new Subject<IUserDados[]>();
  const listB$ = new Subject<IUserDados[]>();
  const userQuery = {
    getUser: vi.fn((uid: string): Observable<IUserDados | null> =>
      uid === 'user-a' ? streamA$ : streamB$
    ),
  };
  let listCount = 0;
  const firestore = {
    getDocumentsByQuery: vi.fn(() => ++listCount === 1 ? listA$ : listB$),
  };
  const runtime = {
    getLoggedUserUIDSnapshot: vi.fn(() => activeUid),
    markUnhydrated: vi.fn(),
    restoreFromCacheForUid: vi.fn(),
    getSnapshot: vi.fn(),
    set: vi.fn(),
    setUnavailable: vi.fn(),
    clear: vi.fn(),
  };
  const errors = { handleError: vi.fn() };
  const privacy = { canLog: vi.fn(() => false), log: vi.fn() };
  const effects = new UserEffects(
    new Actions(actions$),
    firestore as never,
    userQuery as never,
    runtime as never,
    errors as never,
    privacy as never
  );
  return {
    actions$, streamA$, streamB$, listA$, listB$, userQuery,
    runtime, errors, effects,
    changeUid: (uid: string | null) => { activeUid = uid; },
  };
}

describe('UserEffects - fronteira de sessão A→B', () => {
  it('não publica nem reidrata resposta atrasada de A depois que a sessão passou para B', () => {
    const h = harness();
    const outputs: Action[] = [];
    const sub = h.effects.observeUserChanges$.subscribe((action) => outputs.push(action));

    h.actions$.next(observeUserChanges({ uid: 'user-a' }));
    h.streamA$.next(user('user-a'));
    expect(h.runtime.set).toHaveBeenCalledTimes(1);
    expect(outputs.filter((action) => action.type === setCurrentUser.type)).toHaveLength(1);

    h.changeUid('user-b');
    h.streamA$.next(user('user-a'));
    expect(h.runtime.set).toHaveBeenCalledTimes(1);
    expect(outputs.filter((action) => action.type === setCurrentUser.type)).toHaveLength(1);

    h.actions$.next(observeUserChanges({ uid: 'user-b' }));
    h.streamA$.next(user('user-a'));
    h.streamB$.next(user('user-b'));
    expect(h.runtime.set).toHaveBeenCalledTimes(2);
    expect(h.runtime.set).toHaveBeenLastCalledWith(expect.objectContaining({ uid: 'user-b' }));
    expect(outputs.filter((action) => action.type === setCurrentUser.type)).toHaveLength(2);
    expect(outputs.filter((action) => action.type === addUserToState.type)).toHaveLength(2);
    sub.unsubscribe();
  });

  it('descarta timer de perfil indisponível quando a sessão mudou antes da confirmação', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const outputs: Action[] = [];
      const sub = h.effects.observeUserChanges$.subscribe((action) => outputs.push(action));
      h.actions$.next(observeUserChanges({ uid: 'user-a' }));
      h.streamA$.next(null);
      h.changeUid('user-b');
      await vi.advanceTimersByTimeAsync(500);
      expect(h.runtime.setUnavailable).not.toHaveBeenCalled();
      expect(outputs).toHaveLength(0);
      sub.unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignora snapshot com UID diferente do documento observado', () => {
    const h = harness();
    const outputs: Action[] = [];
    const sub = h.effects.observeUserChanges$.subscribe((action) => outputs.push(action));
    h.actions$.next(observeUserChanges({ uid: 'user-a' }));
    h.streamA$.next(user('user-b'));
    expect(h.runtime.set).not.toHaveBeenCalled();
    expect(outputs).toHaveLength(0);
    sub.unsubscribe();
  });

  it('não publica carregamento genérico iniciado por A depois de autenticar B', () => {
    const h = harness();
    const outputs: Action[] = [];
    const sub = h.effects.loadUsers$.subscribe((action) => outputs.push(action));

    h.actions$.next(loadUsers());
    h.changeUid('user-b');
    h.listA$.next([user('user-a')]);
    expect(outputs).toHaveLength(0);

    h.actions$.next(loadUsers());
    h.listB$.next([user('user-b')]);
    expect(outputs).toHaveLength(1);
    sub.unsubscribe();
  });
});
