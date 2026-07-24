// src/app/core/services/autentication/auth/current-user-store.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Auth } from '@angular/fire/auth';

import { CurrentUserStoreService } from './current-user-store.service';
import { CacheService } from '../../general/cache/cache.service';
import { AuthSessionService } from './auth-session.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
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
    authCurrentUserMock = null;

    TestBed.configureTestingModule({
      providers: [
        CurrentUserStoreService,
        { provide: CacheService, useClass: MockCacheService },
        {
          provide: AuthSessionService,
          useClass: MockAuthSessionService,
        },
        { provide: Auth, useValue: authMock },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(CurrentUserStoreService);
    cache = TestBed.inject(CacheService) as unknown as MockCacheService;
    authSession = TestBed.inject(
      AuthSessionService
    ) as unknown as MockAuthSessionService;

    vi.clearAllMocks();
    authSession.currentAuthUser = null;
    authSession.ready$.next(false);
    authSession.uid$.next(null);
    authSession.authUser$.next(null);
  });

  it('deve ser criado e iniciar com tri-state undefined', () => {
    expect(service).toBeTruthy();
    expect(service.getSnapshot()).toBeUndefined();
  });

  it('set() mantém perfil apenas no runtime e grava somente currentUserUid', () => {
    service.set(userMock);

    expect(service.getSnapshot()).toEqual(userMock);
    expect(cache.set).toHaveBeenCalledWith(
      'currentUserUid',
      'u1',
      undefined,
      { persist: false }
    );
    expect(cache.set).not.toHaveBeenCalledWith(
      'currentUser',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('set() não escreve novamente se o usuário for equivalente', () => {
    service.set(userMock);
    vi.clearAllMocks();

    service.set({ ...userMock });

    expect(cache.set).not.toHaveBeenCalled();
  });

  it('patch() atualiza o runtime e continua gravando somente o UID', () => {
    service.set(userMock);
    vi.clearAllMocks();

    service.patch({ nickname: 'alex-updated' });

    expect(service.getSnapshot()).toEqual({
      ...userMock,
      nickname: 'alex-updated',
    });
    expect(cache.set).toHaveBeenCalledWith(
      'currentUserUid',
      'u1',
      undefined,
      { persist: false }
    );
    expect(
      cache.set.mock.calls.some((call) => call[0] === 'currentUser')
    ).toBe(false);
  });

  it('clear() marca null e remove UID e perfil legado', () => {
    service.set(userMock);
    vi.clearAllMocks();

    service.clear();

    expect(service.getSnapshot()).toBeNull();
    expect(cache.delete).toHaveBeenCalledWith('currentUser');
    expect(cache.delete).toHaveBeenCalledWith('currentUserUid');
  });

  it('setUnavailable() remove perfil legado e preserva UID do Auth', () => {
    authCurrentUserMock = { uid: 'auth-uid' };

    service.setUnavailable();

    expect(service.getSnapshot()).toBeNull();
    expect(cache.delete).toHaveBeenCalledWith('currentUser');
    expect(cache.set).toHaveBeenCalledWith(
      'currentUserUid',
      'auth-uid',
      undefined,
      { persist: false }
    );
  });

  it('markUnhydrated() volta o estado para undefined', () => {
    service.set(userMock);
    service.markUnhydrated();

    expect(service.getSnapshot()).toBeUndefined();
  });

  it('getLoggedUserUIDSnapshot() prioriza auth.currentUser.uid', () => {
    authCurrentUserMock = { uid: 'auth-uid' };
    cache.getSync.mockReturnValue('cache-uid');

    expect(service.getLoggedUserUIDSnapshot()).toBe('auth-uid');
  });

  it('getLoggedUserUIDSnapshot() usa currentUserUid quando Auth não existe', () => {
    cache.getSync.mockReturnValue('cache-uid');

    expect(service.getLoggedUserUIDSnapshot()).toBe('cache-uid');
  });

  it('getLoggedUserUIDSnapshot() usa runtime como último fallback', () => {
    cache.getSync.mockReturnValue(null);
    service.set(userMock);

    expect(service.getLoggedUserUIDSnapshot()).toBe('u1');
  });

  it('restoreFromCacheForUid() não restaura perfil completo e saneia legado', () => {
    cache.getSync.mockReturnValue(userMock);

    const restored = service.restoreFromCacheForUid('u1');

    expect(restored).toBeNull();
    expect(service.getSnapshot()).toBeUndefined();
    expect(cache.delete).toHaveBeenCalledWith('currentUser');
    expect(cache.set).toHaveBeenCalledWith(
      'currentUserUid',
      'u1',
      undefined,
      { persist: false }
    );
  });

  it('restoreFromCacheForUid() com UID vazio apenas remove o legado', () => {
    expect(service.restoreFromCacheForUid('   ')).toBeNull();
    expect(cache.delete).toHaveBeenCalledWith('currentUser');
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('restoreFromCache() mantém API e nunca hidrata perfil do browser', () => {
    authSession.currentAuthUser = { uid: 'u1' };
    cache.getSync.mockReturnValue(userMock);

    expect(service.restoreFromCache()).toBeNull();
    expect(service.getSnapshot()).toBeUndefined();
  });

  it('getLoggedUserUID$() reflete uid$ do AuthSessionService', async () => {
    authSession.uid$.next('u-123');

    expect(
      await firstValueFrom(service.getLoggedUserUID$())
    ).toBe('u-123');
  });

  it('getLoggedUserUIDOnce$() emite uma vez', async () => {
    authSession.uid$.next('u-once');

    expect(
      await firstValueFrom(service.getLoggedUserUIDOnce$())
    ).toBe('u-once');
  });

  it('getAuthReady$() reflete ready$ do AuthSessionService', async () => {
    authSession.ready$.next(true);

    expect(await firstValueFrom(service.getAuthReady$())).toBe(true);
  });

  it('restoreFromCacheWhenReady$() espera ready e retorna null', async () => {
    const promise = firstValueFrom(
      service.restoreFromCacheWhenReady$()
    );

    authSession.currentAuthUser = { uid: 'u1' };
    authSession.ready$.next(true);

    expect(await promise).toBeNull();
  });

  it('isHydratedOnce$() emite true ao sair de undefined', async () => {
    const promise = firstValueFrom(service.isHydratedOnce$());

    service.set(userMock);

    expect(await promise).toBe(true);
  });

  it('user$ reflete undefined -> user -> null', () => {
    const emissions: Array<IUserDados | null | undefined> = [];
    const subscription = service.user$.subscribe((value) =>
      emissions.push(value)
    );

    service.set(userMock);
    service.clear();

    expect(emissions).toEqual([undefined, userMock, null]);
    subscription.unsubscribe();
  });
});
