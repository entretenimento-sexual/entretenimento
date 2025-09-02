// app\core\services\autentication\auth.service.spec.ts
/** ========================================================================
 * Mocks de módulos (precisam vir antes dos imports reais)
 * ====================================================================== */
jest.mock('src/environments/environment', () => ({
  environment: { firebase: { projectId: 'demo', apiKey: 'x' } },
}));

// Mock do Firebase App
jest.mock('firebase/app', () => ({
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));

// Mock do Realtime Database
const onDisconnectObj: { set: jest.Mock<Promise<void>, [unknown?]> } = {
  set: jest.fn((_value?: unknown) => Promise.resolve()),
};

// 🔧 Corrige assinaturas: ref(db, path), set(ref, value), onDisconnect(ref)
jest.mock('firebase/database', () => ({
  getDatabase: jest.fn(),
  ref: jest.fn((_db?: unknown, _path?: string) => ({})),
  set: jest.fn((_ref?: unknown, _value?: unknown) => Promise.resolve()),
  serverTimestamp: jest.fn(() => 123456789),
  onDisconnect: jest.fn((_ref?: unknown) => onDisconnectObj),
}));

// Mock de AngularFire Auth (token + funções)
// 🔧 Corrige assinaturas: authState(auth), signOut(auth)
// (o retorno será configurado nos testes via .mockReturnValue)
jest.mock('@angular/fire/auth', () => {
  const Auth = Symbol('Auth');
  return {
    Auth,
    authState: jest.fn((_auth?: unknown) => ({} as any)),
    signOut: jest.fn((_auth?: unknown) => Promise.resolve()),
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

// Acessos aos mocks para asserções
const fbApp = jest.requireMock('firebase/app');
const rtdb = jest.requireMock('firebase/database');

const mAuthState = authState as unknown as jest.Mock;
const mSignOut = signOut as unknown as jest.Mock;

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
 * Helpers
 * ====================================================================== */
function setup(authStateReturn: any, providersExtra: Provider[] = [], opts: { existingApp?: boolean } = {}) {
  jest.clearAllMocks();

  if (opts.existingApp) {
    fbApp.getApps.mockReturnValue([{}]);   // já existe → NÃO inicializa
  } else {
    fbApp.getApps.mockReturnValue([]);     // força initializeApp
  }
  fbApp.initializeApp.mockReturnValue({});
  rtdb.getDatabase.mockReturnValue({});

  mAuthState.mockReturnValue(authStateReturn);

  TestBed.configureTestingModule({
    providers: [
      { provide: UsuarioService, useClass: UsuarioServiceMock },
      { provide: FirestoreUserQueryService, useClass: FirestoreUserQueryServiceMock },
      { provide: GlobalErrorHandlerService, useClass: GlobalErrorHandlerServiceMock },
      { provide: CacheService, useClass: CacheServiceMock },
      { provide: Store, useClass: StoreMock },
      { provide: Router, useClass: RouterMock },
      { provide: EmailVerificationService, useClass: EmailVerificationServiceMock },
      // Token do AngularFire Auth injetado no service
      { provide: Auth, useValue: { currentUser: { uid: 'u-auth', emailVerified: false } } },
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

  it('inicializa Firebase App se não houver apps', () => {
    setup(of(null)); // authState -> null
    expect(fbApp.getApps).toHaveBeenCalled();
    expect(fbApp.initializeApp).toHaveBeenCalled();
  });

  it('não inicializa app extra se já houver app', () => {
    setup(of(null), [], { existingApp: true });
    expect(fbApp.initializeApp).not.toHaveBeenCalled();
  });

  it('authState(null) → limpa estado e despacha logoutSuccess', fakeAsync(() => {
    const { service, store } = setup(of(null));
    // construtor já assinou authState e processou null
    tick();

    expect(service.currentUser).toBeNull();
    const types = (store.dispatch as jest.Mock).mock.calls.map(c => c[0]?.type);
    expect(types).toContain(logoutSuccess.type);
  }));

  it('authState(user) → define usuário, cacheia e marca online (RTDB + Firestore)', fakeAsync(() => {
    // emite um usuário do auth
    const { service, cache, store, usuario } = setup(of({ uid: 'u-auth', email: 'x@x.com', emailVerified: false } as any));
    tick(); // processa taps internos

    // currentUser carregado
    expect(service.currentUser?.uid).toBe('u-auth');

    // store recebeu loginSuccess
    const types = (store.dispatch as jest.Mock).mock.calls.map(c => c[0]?.type);
    expect(types).toContain(loginSuccess.type);

    // presença marcada
    expect(rtdb.set).toHaveBeenCalled();          // status online no RTDB
    expect(rtdb.onDisconnect).toHaveBeenCalled(); // handler de disconnect
    expect(usuario.updateUserOnlineStatus).toHaveBeenCalledWith('u-auth', true);

    // persistido no cache/local
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
    expect(store.dispatch).toHaveBeenCalled(); // ação setCurrentUser
    expect(localStorage.getItem('currentUser')).toContain('"uid":"p-1"');
  });

  it('logout: marca OFFLINE (Firestore + RTDB) antes de signOut e navega para /login', fakeAsync(() => {
    const { service, cache, usuario, router, store } = setup(of({ uid: 'u-auth' } as any));
    // UID vem do cache (getLoggedUserUID$)
    (cache.get as jest.Mock).mockImplementation((k: string) => of(k === 'currentUserUid' ? 'uid-x' : null));

    let finished = false;
    service.logout().subscribe(() => { finished = true; });

    tick(); // drena todas as microtasks/promises

    // chamadas ocorreram
    expect(usuario.updateUserOnlineStatus).toHaveBeenCalledWith('uid-x', false);
    expect(rtdb.set).toHaveBeenCalled(); // status offline no RTDB
    expect(mSignOut).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);

    // ✅ ORDEM: offline antes do signOut
    const callOrderUpdate = (usuario.updateUserOnlineStatus as jest.Mock).mock.invocationCallOrder[0];
    const callOrderRTDB = (rtdb.set as jest.Mock).mock.invocationCallOrder[0];
    const callOrderSignOut = mSignOut.mock.invocationCallOrder[0];
    expect(callOrderUpdate).toBeLessThan(callOrderSignOut);
    expect(callOrderRTDB).toBeLessThan(callOrderSignOut);

    expect(finished).toBe(true);

    // durante o logout emitimos a action [Auth] Logout (não é o logoutSuccess)
    const types = (store.dispatch as jest.Mock).mock.calls.map(c => c[0]?.type);
    expect(types.filter(t => t === '[Auth] Logout').length).toBeGreaterThan(0);
  }));

  it('logout sem UID: ainda executa signOut e navega (gracioso)', fakeAsync(() => {
    const { service, cache, usuario, router } = setup(of(null));
    (cache.get as jest.Mock).mockImplementation(() => of(null)); // sem UID no cache
    // força auth.currentUser sem uid
    (TestBed.inject(Auth) as any).currentUser = null;

    // 🔧 zera chamadas do "online" inicial
    (usuario.updateUserOnlineStatus as jest.Mock).mockClear();
    (rtdb.set as jest.Mock).mockClear();

    service.logout().subscribe();

    tick();

    // não tenta update no Firestore (sem uid)
    expect(usuario.updateUserOnlineStatus).not.toHaveBeenCalled();
    expect(mSignOut).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  }));
});
