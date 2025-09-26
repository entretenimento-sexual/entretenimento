// app\core\services\autentication\auth.service.spec.ts
/** ========================================================================
 * Mocks que precisam vir antes dos imports reais
 * ====================================================================== */
jest.mock('src/environments/environment', () => ({
  environment: { firebase: { projectId: 'demo', apiKey: 'x' } },
}));

// Mock de AngularFire Auth
jest.mock('@angular/fire/auth', () => {
  const Auth = Symbol('Auth');
  return {
    Auth,
    authState: jest.fn((_auth?: unknown) => ({} as any)),
    signOut: jest.fn((_auth?: unknown) => Promise.resolve()),
  };
});

// Mock de AngularFire Firestore (usado pelo heartbeat)
jest.mock('@angular/fire/firestore', () => {
  const Firestore = Symbol('Firestore');
  return {
    Firestore,
    doc: jest.fn((_db: unknown, _col: string, _id: string) => ({ _path: [_col, _id] })),
    updateDoc: jest.fn((_ref: unknown, _data: unknown) => Promise.resolve()),
    serverTimestamp: jest.fn(() => 123456789),
  };
});

/** ========================================================================
 * Imports reais após mocks
 * ====================================================================== */
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Injector, Provider } from '@angular/core';
import { Observable, of } from 'rxjs';

import { Router } from '@angular/router';
import { Store } from '@ngrx/store';

import { AuthService } from './auth.service';
import { UsuarioService } from '../user-profile/usuario.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { CacheService } from '../general/cache/cache.service';
import { EmailVerificationService } from './register/email-verification.service';

import { loginSuccess, logoutSuccess } from '../../../store/actions/actions.user/auth.actions';
import { Auth, authState, signOut } from '@angular/fire/auth';
import { Firestore, doc, updateDoc, serverTimestamp } from '@angular/fire/firestore';
import { expect as jestExpect } from '@jest/globals';

/** ========================================================================
 * Acessos aos mocks
 * ====================================================================== */
const mAuthState = authState as unknown as jest.Mock;
const mSignOut = signOut as unknown as jest.Mock;
const mDoc = doc as unknown as jest.Mock;
const mUpdateDoc = updateDoc as unknown as jest.Mock;
const mServerTs = serverTimestamp as unknown as jest.Mock;

/** ========================================================================
 * Stubs de serviços injetados
 * ====================================================================== */
class UsuarioServiceMock {
  updateUserOnlineStatus = jest
    .fn<Observable<undefined>, [string, boolean]>()
    .mockImplementation((_uid: string, _isOnline: boolean) => of(void 0));
}
class FirestoreUserQueryServiceMock {
  getUser = jest.fn((uid: string) => of({ uid, nickname: 'Nick', emailVerified: false } as any));
}
class GlobalErrorHandlerServiceMock { handleError = jest.fn(); }
class CacheServiceMock {
  private store = new Map<string, any>();
  get = jest.fn((k: string) => of(this.store.get(k) ?? null));
  set = jest.fn((k: string, v: any, _ttl?: number) => { this.store.set(k, v); });
}
class StoreMock { dispatch = jest.fn(); }
class RouterMock {
  navigate = jest
    .fn<Promise<boolean>, [any[]?, any?]>()
    .mockImplementation((_commands?: any[], _extras?: any) => Promise.resolve(true));
}
class EmailVerificationServiceMock {
  updateEmailVerificationStatus = jest
    .fn<Observable<undefined>, [string, boolean]>()
    .mockImplementation((_uid: string, _verified: boolean) => of(void 0));
}

/** ========================================================================
 * Helper de setup
 * ====================================================================== */
function setup(authStateReturn: any, providersExtra: Provider[] = []) {
  jest.clearAllMocks();

  mAuthState.mockReturnValue(authStateReturn);
  mServerTs.mockReturnValue(123456789);

  TestBed.configureTestingModule({
    providers: [
      { provide: UsuarioService, useClass: UsuarioServiceMock },
      { provide: FirestoreUserQueryService, useClass: FirestoreUserQueryServiceMock },
      { provide: GlobalErrorHandlerService, useClass: GlobalErrorHandlerServiceMock },
      { provide: CacheService, useClass: CacheServiceMock },
      { provide: Store, useClass: StoreMock },
      { provide: Router, useClass: RouterMock },
      { provide: EmailVerificationService, useClass: EmailVerificationServiceMock },
      { provide: Auth, useValue: { currentUser: { uid: 'u-auth', emailVerified: false } } },
      { provide: Firestore, useValue: {} }, // 👈 satisfaz DI
      AuthService,
      ...providersExtra,
    ],
  });

  const injector = TestBed.inject(Injector);
  const service = TestBed.inject(AuthService);
  const cache = TestBed.inject(CacheService) as unknown as CacheServiceMock;
  const store = TestBed.inject(Store) as unknown as StoreMock;
  const router = TestBed.inject(Router) as unknown as RouterMock;
  const usuario = TestBed.inject(UsuarioService) as unknown as UsuarioServiceMock;

  return { injector, service, cache, store, router, usuario };
}

/** ========================================================================
 * Testes
 * ====================================================================== */
describe('AuthService', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => { });
  });

  it('authState(null) → limpa estado e despacha logoutSuccess', fakeAsync(() => {
    const { service, store } = setup(of(null));
    tick();

    expect(service.currentUser).toBeNull();
    const types = (store.dispatch as jest.Mock).mock.calls.map(c => c[0]?.type);
    expect(types).toContain(logoutSuccess.type);
  }));

  it('authState(user) → define usuário, cacheia e inicia heartbeat (Firestore)', fakeAsync(() => {
    const { service, cache, store } = setup(of({ uid: 'u-auth', email: 'x@x.com', emailVerified: false } as any));
    tick();

    // usuário atual
    expect(service.currentUser?.uid).toBe('u-auth');

    // store recebeu loginSuccess
    const types = (store.dispatch as jest.Mock).mock.calls.map(c => c[0]?.type);
    expect(types).toContain(loginSuccess.type);

    // heartbeat inicial: updateDoc chamado com isOnline: true e lastSeen
    expect(mDoc).toHaveBeenCalledWith(jestExpect.anything(), 'users', 'u-auth');
    expect(mUpdateDoc).toHaveBeenCalledWith(
      jestExpect.anything(),
      jestExpect.objectContaining({ isOnline: true, lastSeen: jestExpect.anything() })
    );

    // cache/local populado
    const cached = (cache.get as jest.Mock).mock.calls.find(c => c[0] === 'currentUser');
    expect(cached).toBeTruthy();
  }));

  it('getLoggedUserUID$ usa cache quando disponível', (done) => {
    const { service, cache } = setup(of(null));
    cache.set('currentUserUid', 'uid-cached');

    service.getLoggedUserUID$().subscribe((uid) => {
      expect(uid).toBe('uid-cached');
      done();
    });
  });

  it('getLoggedUserUID$ cai para this.auth.currentUser quando não há cache', (done) => {
    const { service, cache } = setup(of(null), [
      { provide: Auth, useValue: { currentUser: { uid: 'u-fallback' } } },
    ]);
    (cache.get as jest.Mock).mockImplementation(() => of(null));

    service.getLoggedUserUID$().subscribe((uid) => {
      expect(uid).toBe('u-fallback');
      done();
    });
  });

  it('setCurrentUser → atualiza subject, localStorage e dispara setCurrentUser internamente', () => {
    const { service, store } = setup(of(null));
    const user = { uid: 'p-1', nickname: 'A' } as any;

    service.setCurrentUser(user);

    expect(service.currentUser?.uid).toBe('p-1');
    expect(store.dispatch).toHaveBeenCalled(); // inclui setCurrentUser/loginSuccess
    expect(localStorage.getItem('currentUser')).toContain('"uid":"p-1"');
  });

  it('logout: marca OFFLINE (Firestore via UsuarioService) antes de signOut e navega para /login', fakeAsync(() => {
    const { service, cache, usuario, router, store } = setup(of({ uid: 'u-auth' } as any));
    // UID vem do cache (getLoggedUserUID$)
    (cache.get as jest.Mock).mockImplementation((k: string) => of(k === 'currentUserUid' ? 'uid-x' : null));

    let finished = false;
    service.logout().subscribe(() => { finished = true; });

    tick();

    // chamadas ocorreram
    expect(usuario.updateUserOnlineStatus).toHaveBeenCalledWith('uid-x', false);
    expect(mSignOut).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(finished).toBe(true);

    // clearCurrentUser() dispara logoutSuccess
    const types = (store.dispatch as jest.Mock).mock.calls.map(c => c[0]?.type);
    expect(types).toContain(logoutSuccess.type);
  }));

  it('logout sem UID: não chama signOut nem navega', fakeAsync(() => {
    const { service, cache, usuario, router } = setup(of(null));
    (cache.get as jest.Mock).mockImplementation(() => of(null)); // sem UID no cache
    (TestBed.inject(Auth) as any).currentUser = null;

    // zera contadores
    (usuario.updateUserOnlineStatus as jest.Mock).mockClear();
    mSignOut.mockClear();
    (router.navigate as jest.Mock).mockClear();

    service.logout().subscribe();
    tick();

    expect(usuario.updateUserOnlineStatus).not.toHaveBeenCalled();
    expect(mSignOut).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  }));
});
