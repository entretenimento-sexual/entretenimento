// app\core\services\autentication\auth.service.spec.ts
// ===================== Mocks (antes de qualquer import real) =====================

// mock do environment
jest.mock('src/environments/environment', () => ({
  environment: { firebase: { projectId: 'demo', apiKey: 'x' } },
}));

// objeto usado por onDisconnect().set(...)
const onDisconnectObj = { set: jest.fn(() => Promise.resolve()) };

jest.mock('firebase/app', () => ({
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));

jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(),
  onAuthStateChanged: jest.fn((_auth: any, _cb: any) => {
    // retorna função de unsubscribe fake
    return jest.fn();
  }),
  signOut: jest.fn(() => Promise.resolve()),
}));

jest.mock('firebase/database', () => ({
  getDatabase: jest.fn(),
  ref: jest.fn(() => ({})),
  set: jest.fn(() => Promise.resolve()),
  serverTimestamp: jest.fn(() => 123456789),
  onDisconnect: jest.fn(() => onDisconnectObj),
}));

// ===================== Imports reais =====================

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Injector } from '@angular/core';
import { of } from 'rxjs';

import { AuthService } from './auth.service';
import { UsuarioService } from '../user-profile/usuario.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { CacheService } from '../general/cache/cache.service';
import { Store } from '@ngrx/store';
import { Router } from '@angular/router';

import { loginSuccess, logoutSuccess } from '../../../store/actions/actions.user/auth.actions';

// pegue SEMPRE os mocks via requireMock (é o mesmo módulo que o serviço usa)
const firebaseApp = jest.requireMock('firebase/app') as {
  getApps: jest.Mock; initializeApp: jest.Mock;
};
const firebaseAuth = jest.requireMock('firebase/auth') as {
  getAuth: jest.Mock; onAuthStateChanged: jest.Mock; signOut: jest.Mock;
};
const firebaseDb = jest.requireMock('firebase/database') as {
  getDatabase: jest.Mock; ref: jest.Mock; set: jest.Mock; onDisconnect: jest.Mock;
};

// ===================== Mocks dos serviços injetados =====================

class UsuarioServiceMock {
  updateUserOnlineStatus = jest.fn(() => of(void 0)) as jest.Mock;
}
class FirestoreUserQueryServiceMock {
  getUser = jest.fn(() => of({ uid: 'u-123', nickname: 'Nick' } as any));
}
class GlobalErrorHandlerServiceMock {
  handleError = jest.fn();
}
class CacheServiceMock {
  private store = new Map<string, any>();
  get = jest.fn((k: string) => of(this.store.get(k) ?? null));
  set = jest.fn((k: string, v: any) => { this.store.set(k, v); });
}
class StoreMock {
  dispatch = jest.fn();
}
class RouterMock {
  navigate = jest.fn((..._args: any[]) => Promise.resolve(true)) as jest.Mock;
}

// ===================== Suite =====================

describe('AuthService', () => {
  let injector: Injector;

  const tb = () => ({
    cache: TestBed.inject(CacheService) as unknown as CacheServiceMock,
    store: TestBed.inject(Store) as unknown as StoreMock,
    router: TestBed.inject(Router) as unknown as RouterMock,
    usuario: TestBed.inject(UsuarioService) as unknown as UsuarioServiceMock,
    userQuery: TestBed.inject(FirestoreUserQueryService) as unknown as FirestoreUserQueryServiceMock,
  });

  const createService = () =>
    new AuthService(
      TestBed.inject(Router) as any,
      injector,
      TestBed.inject(FirestoreUserQueryService) as any,
      TestBed.inject(GlobalErrorHandlerService) as any,
      TestBed.inject(CacheService) as any,
      TestBed.inject(Store) as any
    );

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => { });
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // defaults dos mocks firebase
    firebaseApp.getApps.mockReturnValue([]);         // força initializeApp por padrão
    firebaseApp.initializeApp.mockReturnValue({});
    firebaseAuth.getAuth.mockReturnValue({ currentUser: { uid: 'u-auth' } });
    firebaseDb.getDatabase.mockReturnValue({});

    TestBed.configureTestingModule({
      providers: [
        { provide: UsuarioService, useClass: UsuarioServiceMock },
        { provide: FirestoreUserQueryService, useClass: FirestoreUserQueryServiceMock },
        { provide: GlobalErrorHandlerService, useClass: GlobalErrorHandlerServiceMock },
        { provide: CacheService, useClass: CacheServiceMock },
        { provide: Store, useClass: StoreMock },
        { provide: Router, useClass: RouterMock },
      ],
    });

    injector = TestBed.inject(Injector);
  });

  it('inicializa o Firebase App se não houver apps', () => {
    firebaseApp.getApps.mockReturnValue([]); // sem apps
    const service = createService();

    expect(service).toBeTruthy();
    expect(firebaseApp.getApps).toHaveBeenCalled();
    expect(firebaseApp.initializeApp).toHaveBeenCalled();
  });

  it('não inicializa app extra se já houver um app', () => {
    firebaseApp.getApps.mockReturnValue([{}]); // já existe app
    const service = createService();

    expect(service).toBeTruthy();
    expect(firebaseApp.getApps).toHaveBeenCalled();
    expect(firebaseApp.initializeApp).not.toHaveBeenCalled();
  });

  it('quando onAuthStateChanged emite null: limpa estado e despacha logout', fakeAsync(() => {
    const { store } = tb();
    const service = createService();

    const cb = firebaseAuth.onAuthStateChanged.mock.calls.at(-1)[1];
    cb(null);
    tick(); // drena operadores sync + microtasks

    expect(service.currentUser).toBeNull();
    expect(store.dispatch).toHaveBeenCalled();
    const types = (store.dispatch as jest.Mock).mock.calls.map(c => c[0]?.type);
    expect(types).toContain(logoutSuccess.type);
  }));

  it('quando onAuthStateChanged emite usuário: usa cache, define usuário e atualiza status online', fakeAsync(() => {
    const { cache, store, usuario } = tb();
    cache.set('currentUser', { uid: 'u-auth', nickname: 'FromCache' });

    const service = createService();
    const cb = firebaseAuth.onAuthStateChanged.mock.calls.at(-1)[1];
    cb({ uid: 'u-auth' });
    tick(); // emite + tap (define usuário)
    tick(); // drena Promises de set()/onDisconnect().set()

    expect(service.currentUser?.uid).toBe('u-auth');

    const types = (store.dispatch as jest.Mock).mock.calls.map(c => c[0]?.type);
    expect(types).toContain(loginSuccess.type);

    expect(firebaseDb.set).toHaveBeenCalled();
    expect(firebaseDb.onDisconnect).toHaveBeenCalled();
    expect(onDisconnectObj.set).toHaveBeenCalled();
    expect(usuario.updateUserOnlineStatus).toHaveBeenCalled();
  }));

  it('getLoggedUserUID$ retorna UID do cache quando existir', (done) => {
    const { cache } = tb();
    cache.set('currentUserUid', 'uid-cached');

    const service = createService();

    service.getLoggedUserUID$().subscribe((uid) => {
      expect(uid).toBe('uid-cached');
      // getAuth foi usado apenas no construtor
      expect(firebaseAuth.getAuth).toHaveBeenCalledTimes(1);
      done();
    });
  });

  it('getLoggedUserUID$ cai para Firebase Auth quando não há cache', (done) => {
    const { cache } = tb();
    cache.get.mockImplementation((_k: string) => of(null)); // sem cache

    const service = createService();
    // garante fallback lendo de this.auth (não chama getAuth de novo)
    (service as any).auth = { currentUser: { uid: 'u-auth-2' } };

    service.getLoggedUserUID$().subscribe((uid) => {
      expect(uid).toBe('u-auth-2');
      expect(cache.set).toHaveBeenCalled();
      done();
    });
  });

  it('setCurrentUser escreve subject, localStorage e despacha setCurrentUser', () => {
    const { store } = tb();
    const service = createService();

    const data = { uid: 'p-1', nickname: 'A' } as any;
    service.setCurrentUser(data);

    expect(service.currentUser?.uid).toBe('p-1');
    expect(store.dispatch).toHaveBeenCalled();
    expect(localStorage.getItem('currentUser')).toContain('"uid":"p-1"');
  });

  it('logout: marca offline, faz signOut, limpa estado e navega para /login', fakeAsync(() => {
    const { cache, usuario, store, router } = tb();
    cache.get.mockImplementation((k: string) => of(k === 'currentUserUid' ? 'uid-x' : null));

    const service = createService();
    (service as any).cachedUid$ = null; // zera cache interno

    let finished = false;
    service.logout().subscribe(() => { finished = true; });

    tick(); // updateUserOnlineStatus + signOut + clear + navigate
    expect(finished).toBe(true);

    expect(usuario.updateUserOnlineStatus).toHaveBeenCalledWith('uid-x', false);
    expect(firebaseAuth.signOut).toHaveBeenCalled();
    expect(store.dispatch).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  }));
});
