// src/app/core/services/autentication/auth/current-user-store.service.spec.ts
// utilizando ferramentas nativas
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, beforeEach, it, expect, vi, type Mock } from 'vitest';

import { Auth } from '@angular/fire/auth';

import { CurrentUserStoreService } from './current-user-store.service';
import { CacheService } from '../../general/cache/cache.service';
import { AuthSessionService } from './auth-session.service';
import { IUserDados } from '../../../interfaces/iuser-dados';

class MockCacheService {
  set = vi.fn();
  delete = vi.fn();
  getSync = vi.fn();
}

class MockAuthSessionService {
  ready$ = new BehaviorSubject<boolean>(false);
  uid$ = new BehaviorSubject<string | null>(null);
  authUser$ = new BehaviorSubject<any | null>(null);
  currentAuthUser: { uid: string } | null = null;
}

describe('CurrentUserStoreService', () => {
  let service: CurrentUserStoreService;
  let cache: MockCacheService;
  let authSession: MockAuthSessionService;

  // backing field mutável para contornar o readonly de Auth.currentUser
  let authCurrentUserMock: { uid: string } | null;

  const authMock: Partial<Auth> = {
    get currentUser() {
      return authCurrentUserMock as any;
    },
  };

  const userMock: IUserDados = {
    uid: 'u1',
    email: 'alex@test.com',
    nickname: 'alex',
    role: 'premium',
    profileCompleted: true,
    isSubscriber: true,
  } as IUserDados;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CurrentUserStoreService,
        { provide: CacheService, useClass: MockCacheService },
        { provide: AuthSessionService, useClass: MockAuthSessionService },
        { provide: Auth, useValue: authMock },
      ],
    });

    service = TestBed.inject(CurrentUserStoreService);
    cache = TestBed.inject(CacheService) as any;
    authSession = TestBed.inject(AuthSessionService) as any;

    vi.clearAllMocks();
    authCurrentUserMock = null;
    authSession.currentAuthUser = null;
    authSession.ready$.next(false);
    authSession.uid$.next(null);
    authSession.authUser$.next(null);
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('deve iniciar com tri-state undefined', () => {
    const value = service.getSnapshot();
    expect(value).toBeUndefined();
  });

  it('set() deve atualizar o userSubject e HOT_KEYS no cache', () => {
    service.set(userMock);

    expect(service.getSnapshot()).toEqual(userMock);
    expect(cache.set).toHaveBeenCalledWith('currentUser', userMock, undefined, { persist: false });
    expect(cache.set).toHaveBeenCalledWith('currentUserUid', 'u1', undefined, { persist: false });
  });

  it('set() não deve escrever novamente se o usuário for idêntico', () => {
    service.set(userMock);
    vi.clearAllMocks();

    service.set({ ...userMock });

    expect(cache.set).not.toHaveBeenCalled();
  });

it('patch() deve mesclar os dados do usuário atual', () => {
  service.set(userMock);
  vi.clearAllMocks();

  service.patch({ nickname: 'alex-updated' });

  expect(service.getSnapshot()).toEqual({
    ...userMock,
    nickname: 'alex-updated',
  });

 const currentUserCall = cache.set.mock.calls.find(
  (call: any[]) => call[0] === 'currentUser'
);

if (!currentUserCall) {
  throw new Error('currentUser call não encontrado');
}

  expect(currentUserCall[1]).toBeDefined();
  expect(currentUserCall[1].nickname).toBe('alex-updated');
  expect(currentUserCall[1].uid).toBe('u1');
  expect(currentUserCall[2]).toBeUndefined();
  expect(currentUserCall[3]).toEqual({ persist: false });

  expect(cache.set).toHaveBeenCalledWith(
    'currentUserUid',
    'u1',
    undefined,
    { persist: false }
  );
});

  it('clear() deve marcar estado como null e limpar HOT_KEYS', () => {
    service.set(userMock);
    vi.clearAllMocks();

    service.clear();

    expect(service.getSnapshot()).toBeNull();
    expect(cache.delete).toHaveBeenCalledWith('currentUser');
    expect(cache.delete).toHaveBeenCalledWith('currentUserUid');
  });

  it('markUnhydrated() deve voltar o estado para undefined', () => {
    service.set(userMock);

    service.markUnhydrated();

    expect(service.getSnapshot()).toBeUndefined();
  });

  it('getLoggedUserUIDSnapshot() deve priorizar auth.currentUser.uid', () => {
    authCurrentUserMock = { uid: 'auth-uid' };
    cache.getSync.mockReturnValue('cache-uid');

    const uid = service.getLoggedUserUIDSnapshot();

    expect(uid).toBe('auth-uid');
  });

  it('getLoggedUserUIDSnapshot() deve usar cache quando auth.currentUser não existir', () => {
    authCurrentUserMock = null;
    cache.getSync.mockReturnValue('cache-uid');

    const uid = service.getLoggedUserUIDSnapshot();

    expect(uid).toBe('cache-uid');
  });

  it('getLoggedUserUIDSnapshot() deve usar userSubject quando auth/cache não existirem', () => {
    authCurrentUserMock = null;
    cache.getSync.mockReturnValue(null);
    service.set(userMock);

    const uid = service.getLoggedUserUIDSnapshot();

    expect(uid).toBe('u1');
  });

  it('restoreFromCacheForUid() deve restaurar do cache quando uid bater', () => {
    cache.getSync.mockReturnValue(userMock);

    const restored = service.restoreFromCacheForUid('u1');

    expect(restored).toEqual(userMock);
    expect(service.getSnapshot()).toEqual(userMock);
    expect(cache.set).toHaveBeenCalledWith('currentUserUid', 'u1', undefined, { persist: false });
  });

  it('restoreFromCacheForUid() deve limpar cache stale quando uid não bater', () => {
    cache.getSync.mockReturnValue({ ...userMock, uid: 'other-uid' });

    const restored = service.restoreFromCacheForUid('u1');

    expect(restored).toBeNull();
    expect(cache.delete).toHaveBeenCalledWith('currentUser');
    expect(cache.delete).toHaveBeenCalledWith('currentUserUid');
  });

  it('restoreFromCacheForUid() deve retornar null quando uid vier vazio', () => {
    cache.getSync.mockReturnValue(userMock);

    const restored = service.restoreFromCacheForUid('   ');

    expect(restored).toBeNull();
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it('restoreFromCache() deve usar authSession.currentAuthUser.uid primeiro', () => {
    authSession.currentAuthUser = { uid: 'u1' };
    cache.getSync.mockReturnValue(userMock);

    const restored = service.restoreFromCache();

    expect(restored).toEqual(userMock);
  });

  it('restoreFromCache() deve cair para auth.currentUser.uid quando currentAuthUser não existir', () => {
    authSession.currentAuthUser = null;
    authCurrentUserMock = { uid: 'u1' };
    cache.getSync.mockReturnValue(userMock);

    const restored = service.restoreFromCache();

    expect(restored).toEqual(userMock);
  });

  it('getLoggedUserUID$() deve refletir o uid$ do AuthSessionService', async () => {
    authSession.uid$.next('u-123');

    const uid = await firstValueFrom(service.getLoggedUserUID$());

    expect(uid).toBe('u-123');
  });

  it('getLoggedUserUIDOnce$() deve emitir uma vez', async () => {
    authSession.uid$.next('u-once');

    const uid = await firstValueFrom(service.getLoggedUserUIDOnce$());

    expect(uid).toBe('u-once');
  });

  it('getAuthReady$() deve refletir ready$ do AuthSessionService', async () => {
    authSession.ready$.next(true);

    const ready = await firstValueFrom(service.getAuthReady$());

    expect(ready).toBe(true);
  });

  it('restoreFromCacheWhenReady$() deve esperar ready=true antes de restaurar', async () => {
    cache.getSync.mockReturnValue(userMock);

    const promise = firstValueFrom(service.restoreFromCacheWhenReady$());

    authSession.currentAuthUser = { uid: 'u1' };
    authSession.ready$.next(true);

    const restored = await promise;

    expect(restored).toEqual(userMock);
  });

  it('isHydratedOnce$() deve emitir true quando sair de undefined', async () => {
    const promise = firstValueFrom(service.isHydratedOnce$());

    service.set(userMock);

    const result = await promise;
    expect(result).toBe(true);
  });

  it('user$ deve refletir transições de undefined -> user -> null', () => {
    const emissions: Array<IUserDados | null | undefined> = [];
    const sub = service.user$.subscribe((value) => emissions.push(value));

    service.set(userMock);
    service.clear();

    expect(emissions[0]).toBeUndefined();
    expect(emissions[1]).toEqual(userMock);
    expect(emissions[2]).toBeNull();

    sub.unsubscribe();
  });
});
