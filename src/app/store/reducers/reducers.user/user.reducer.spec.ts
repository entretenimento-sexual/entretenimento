// src/app/store/reducers/reducers.user/user.reducer.spec.ts
import { userReducer } from './user.reducer';
import { initialUserState } from '../../states/states.user/user.state';
import { IUserDados } from '../../../core/interfaces/iuser-dados';
import { Timestamp } from 'firebase/firestore';

import {
  addUserToState,
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  loadOnlineUsersSuccess,
  updateUserOnlineStatus,
  setFilteredOnlineUsers,
  setCurrentUser,
  clearCurrentUser,
} from '../../actions/actions.user/user.actions';

import {
  loginSuccess,
  logoutSuccess
} from '../../actions/actions.user/auth.actions';

function reduceFrom(initial = initialUserState, ...actions: any[]) {
  return actions.reduce((state, action) => userReducer(state, action), initial);
}

/** Helper pra mockar Timestamp.now() do firebase (já stubado no setup-jest) */
const tsNow = () => Timestamp.now();

const u = (overrides?: Partial<IUserDados>): IUserDados => ({
  uid: 'u1',
  email: 'u1@mail.com',
  nickname: 'u1',
  role: 'basico',
  emailVerified: true,
  isOnline: false,
  // ---- obrigatórios na sua interface
  photoURL: null,
  lastLogin: tsNow(),
  firstLogin: tsNow(),
  isSubscriber: false,
  descricao: '',
  // ---- sobrescritas
  ...overrides,
});

const v = (overrides?: Partial<IUserDados>): IUserDados => ({
  uid: 'u2',
  email: 'u2@mail.com',
  nickname: 'u2',
  role: 'vip',
  emailVerified: true,
  isOnline: true,
  // obrigatórios
  photoURL: null,
  lastLogin: tsNow(),
  firstLogin: tsNow(),
  isSubscriber: true,
  descricao: '',
  // sobrescritas
  ...overrides,
});

describe('userReducer', () => {
  it('deve hidratar o mapa ao fazer loginSuccess e setar currentUser', () => {
    const user = u({ isOnline: true });
    const state = reduceFrom(initialUserState, loginSuccess({ user }));

    expect(state.currentUser).toEqual(user);
    expect(state.users[user.uid]).toEqual(user);
    expect(state.onlineUsers.find(x => x.uid === user.uid)).toBeTruthy();
  });

  it('setCurrentUser deve ter o mesmo efeito de loginSuccess (hidrata e seta currentUser)', () => {
    const user = u({ isOnline: false });
    const state = reduceFrom(initialUserState, setCurrentUser({ user }));

    expect(state.currentUser).toEqual(user);
    expect(state.users[user.uid]).toEqual(user);
    expect(state.onlineUsers.find(x => x.uid === user.uid)).toBeFalsy();
  });

  it('updateUserOnlineStatus deve criar patch mínimo quando uid não existe e refletir no array', () => {
    const uid = 'ghost';
    const state = reduceFrom(initialUserState, updateUserOnlineStatus({ uid, isOnline: true }));

    expect(state.users[uid]).toBeTruthy();
    expect(state.users[uid].uid).toBe(uid);
    expect(state.users[uid].isOnline).toBe(true);
    expect(state.onlineUsers.find(x => x.uid === uid)).toBeTruthy();
  });

  it('updateUserOnlineStatus deve espelhar no currentUser quando for o mesmo uid', () => {
    const logged = u({ uid: 'me', isOnline: false });
    const s1 = reduceFrom(initialUserState, loginSuccess({ user: logged }));
    const s2 = reduceFrom(s1, updateUserOnlineStatus({ uid: 'me', isOnline: true }));

    expect(s2.currentUser?.isOnline).toBe(true);
    expect(s2.users['me']?.isOnline).toBe(true);
    expect(s2.onlineUsers.find(x => x.uid === 'me')).toBeTruthy();
  });

  it('loadOnlineUsersSuccess deve preencher users + onlineUsers sem duplicar e mantendo merges', () => {
    const base = reduceFrom(initialUserState, addUserToState({ user: u({ uid: 'x', nickname: 'antes' }) }));

    const incoming = [
      v({ uid: 'x', isOnline: true, nickname: 'depois' }),
      v({ uid: 'y', isOnline: true }),
    ];

    const s2 = reduceFrom(base, loadOnlineUsersSuccess({ users: incoming }));

    expect(s2.users['x']?.nickname).toBe('depois');
    expect(s2.users['y']?.uid).toBe('y');
    expect(s2.onlineUsers.map(u => u.uid).sort()).toEqual(['x', 'y']);
  });

  it('clearCurrentUser deve limpar currentUser e removê-lo de onlineUsers, mantendo o dicionário', () => {
    const me = u({ uid: 'me', isOnline: true });
    const s1 = reduceFrom(initialUserState, loginSuccess({ user: me }));
    const s2 = reduceFrom(s1, clearCurrentUser());

    expect(s2.currentUser).toBeNull();
    expect(s2.onlineUsers.find(x => x.uid === 'me')).toBeFalsy();
    expect(s2.users['me']).toBeTruthy();
  });

  it('logoutSuccess deve limpar currentUser e removê-lo de onlineUsers (mantendo users)', () => {
    const me = u({ uid: 'me', isOnline: true });
    const s1 = reduceFrom(initialUserState, loginSuccess({ user: me }));
    const s2 = reduceFrom(s1, logoutSuccess());

    expect(s2.currentUser).toBeNull();
    expect(s2.onlineUsers.find(x => x.uid === 'me')).toBeFalsy();
    expect(s2.users['me']).toBeTruthy();
  });

  it('loadUsersSuccess deve mesclar lista no dicionário e desligar loading', () => {
    const s1 = reduceFrom(initialUserState, loadUsers());
    expect(s1.loading).toBe(true);

    const list = [u({ uid: 'a' }), u({ uid: 'b' })];
    const s2 = reduceFrom(s1, loadUsersSuccess({ users: list }));

    expect(s2.loading).toBe(false);
    expect(s2.users['a']).toBeTruthy();
    expect(s2.users['b']).toBeTruthy();
    expect(s2.error).toBeNull();
  });

  it('loadUsersFailure deve desligar loading e setar erro', () => {
    const s1 = reduceFrom(initialUserState, loadUsers());
    const s2 = reduceFrom(s1, loadUsersFailure({ error: 'oops' }));

    expect(s2.loading).toBe(false);
    expect(s2.error).toBe('oops');
  });

  it('setFilteredOnlineUsers deve apenas setar o array filtrado', () => {
    const filtered = [v({ uid: 'f1' }), v({ uid: 'f2' })];
    const s = reduceFrom(initialUserState, setFilteredOnlineUsers({ filteredUsers: filtered }));

    // Quick fix pra evitar choque de tipos de matchers (Jasmine vs Jest)
    expect(s.filteredUsers.length).toBe(2);
    expect(s.filteredUsers[0].uid).toBe('f1');
  });
});
