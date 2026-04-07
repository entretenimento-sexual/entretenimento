// src/test/setup-jest.ts
// ============================================================================
// ⚙️ Silenciador de console (deve rodar o mais cedo possível)
// ----------------------------------------------------------------------------
// - Desliga console.log/info/debug por padrão (controlável via env).
// - console.warn também pode ser silenciado (default: true).
// - console.error pode falhar o teste (default: false).
// - Permite "lista branca" via JEST_CONSOLE_ALLOW="palavra1|regex2"
//   (match simples por substring).
// ============================================================================

const __ORIGINAL_CONSOLE__ = {
  log: console.log,
  info: console.info,
  debug: console.debug,
  warn: console.warn,
  error: console.error,
};

// Env flags:
// - JEST_SILENCE_CONSOLE (default: true)  -> log/info/debug
// - JEST_SILENCE_WARN    (default: true)  -> warn
// - JEST_CONSOLE_ALLOW   (default: "")    -> padrões separados por "|"
// - FAIL_ON_CONSOLE_ERROR (default: false)-> lança erro no console.error
const SILENCE_STD = (process.env['JEST_SILENCE_CONSOLE'] ?? 'true') !== 'false';
const SILENCE_WARN = (process.env['JEST_SILENCE_WARN'] ?? 'true') !== 'false';
const FAIL_ON_ERROR = (process.env['FAIL_ON_CONSOLE_ERROR'] ?? 'false') === 'true';
let ALLOW_LIST: string[] = (process.env['JEST_CONSOLE_ALLOW'] ?? '')
  .split('|').map(s => s.trim()).filter(Boolean);

function stringifySafe(v: unknown): string {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
function matchesAllowList(args: unknown[]): boolean {
  if (!ALLOW_LIST.length) return false;
  const text = args.map(stringifySafe).join(' ');
  return ALLOW_LIST.some(p => text.includes(p));
}

// ✅ Spies aplicados AGORA (fora de hooks), para capturar logs em import-time
if (SILENCE_STD) {
  // log/info/debug ficam mudos, exceto se baterem na allowlist
  jest\.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    if (matchesAllowList(args)) __ORIGINAL_CONSOLE__.log(...args);
  });
  jest\.spyOn(console, 'info').mockImplementation((...args: any[]) => {
    if (matchesAllowList(args)) __ORIGINAL_CONSOLE__.info(...args);
  });
  jest\.spyOn(console, 'debug').mockImplementation((...args: any[]) => {
    if (matchesAllowList(args)) __ORIGINAL_CONSOLE__.debug(...args);
  });
}

if (SILENCE_WARN) {
  jest\.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
    if (matchesAllowList(args)) __ORIGINAL_CONSOLE__.warn(...args);
  });
} else {
  // Modo "falante" para warn, porém com prefixo (útil para debugar)
  jest\.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
    if (matchesAllowList(args)) return __ORIGINAL_CONSOLE__.warn(...args);
    __ORIGINAL_CONSOLE__.warn('[WARN nos testes]', ...args);
  });
}

jest\.spyOn(console, 'error').mockImplementation((...args: any[]) => {
  if (matchesAllowList(args)) return __ORIGINAL_CONSOLE__.error(...args);
  // mantém visível no output, mas opcionalmente falha o teste
  __ORIGINAL_CONSOLE__.error('[ERROR nos testes]', ...args);
  if (FAIL_ON_ERROR) {
    const msg = args.map(stringifySafe).join(' ');
    throw new Error(`console.error disparado durante o teste: ${msg}`);
  }
});

// Helpers globais para ajustar allowlist dinamicamente em specs, se necessário:
(globalThis as any).allowConsole = (patterns: string | string[]) => {
  const arr = Array.isArray(patterns) ? patterns : [patterns];
  ALLOW_LIST = [...ALLOW_LIST, ...arr.filter(Boolean)];
};
(globalThis as any).resetConsoleAllow = () => {
  ALLOW_LIST = (process.env['JEST_CONSOLE_ALLOW'] ?? '')
    .split('|').map(s => s.trim()).filter(Boolean);
};

// Restaura após cada arquivo de teste (o Jest reexecuta este setup a cada spec)
afterAll(() => {
  jest.restoreAllMocks();
});

// ============================================================================
// 🔥 Mocks de Firebase (DEVEM vir antes de qualquer import da app)
// ============================================================================

// ---- Pequenos "flags" de ambiente de browser que impactam presence ----
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36';

Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: UA,
    platform: 'Win32',
    vendor: 'Google Inc.',
    language: 'pt-BR',
    onLine: true,
  },
  writable: true,
});

Object.defineProperty(document, 'visibilityState', {
  value: 'visible',
  writable: true,
});

// --- firebase/app ---
jest.mock('firebase/app', () => {
  const app = { name: '[DEFAULT]' };
  return {
    initializeApp: vi.fn(() => app),
    getApps: vi.fn(() => []),
    getApp: vi.fn(() => app),
  };
});

// --- firebase/auth ---
jest.mock('firebase/auth', () => {
  const onAuthStateChanged = vi.fn((_auth: any, _cb: any) => {
    return () => { /* unsubscribe noop */ };
  });
  return {
    getAuth: vi.fn(() => ({ currentUser: null })),
    onAuthStateChanged,
    signOut: vi.fn(() => Promise.resolve()),
    signInWithPopup: vi.fn(() => Promise.resolve({ user: { uid: 'uid-x' } })),
    createUserWithEmailAndPassword: vi.fn(() => Promise.resolve({ user: { uid: 'uid-x' } })),
    sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
    updateProfile: vi.fn(() => Promise.resolve()),
    GoogleAuthProvider: function GoogleAuthProvider() { },
  };
});

// --- firebase/database ---
jest.mock('firebase/database', () => {
  const __refs = new Map<string, any>();
  const ref = vi.fn((_db: any, path?: string) => {
    const key = path ?? '';
    if (!__refs.has(key)) __refs.set(key, { __path: key });
    return __refs.get(key);
  });

  const set = vi.fn(() => Promise.resolve());
  const update = vi.fn(() => Promise.resolve());
  const remove = vi.fn(() => Promise.resolve());

  const onDisconnect = vi.fn((_ref?: any) => ({
    set: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  }));

  const serverTimestamp = vi.fn(() => Date.now());

  const getDatabase = vi.fn(() => ({
    ref, set, update, remove, onDisconnect,
  }));

  return {
    getDatabase,
    ref,
    set,
    update,
    remove,
    onDisconnect,
    serverTimestamp,
  };
});

// --- firebase/firestore ---
jest.mock('firebase/firestore', () => {
  const addDoc = vi.fn(async () => ({ id: 'doc-1' }));
  const setDoc = vi.fn(async () => { });
  const updateDoc = vi.fn(async () => { });
  const deleteDoc = vi.fn(async () => { });

  // doc() carrega a "path" para que getDoc() consiga responder condicionalmente
  const doc = vi.fn((first: any, ...segments: string[]) => {
    const base = typeof first === 'object' && first?.__path ? first.__path : '';
    const path = [base, ...segments].filter(Boolean).join('/');
    return { __path: path };
  });

  const collection = vi.fn((_db: any, ...segments: string[]) => {
    const path = segments.filter(Boolean).join('/');
    return { __path: path };
  });

  const where = vi.fn(() => ({}));
  const query = vi.fn(() => ({}));

  const getDoc = vi.fn(async (docRef: any) => {
    const p: string = docRef?.__path ?? '';
    const id = p.split('/').pop() ?? 'doc-1';
    if (p.startsWith('public_index/')) {
      return { exists: () => false, data: () => undefined, id };
    }
    if (p.startsWith('users/')) {
      return {
        exists: () => true,
        data: () => ({ isSubscriber: true, publicNickname: 'oldnick' }),
        id,
      };
    }
    return { exists: () => false, data: () => undefined, id };
  });

  const getDocs = vi.fn(async () => ({ docs: [] as any[] }));
  const onSnapshot = vi.fn((_q: any, next?: any) => { next?.({ docs: [] }); return () => { }; });

  const serverTimestamp = vi.fn(() => new Date());
  const arrayUnion = vi.fn((...values: any[]) => ({ __op: 'arrayUnion', values }));
  const increment = vi.fn((n: number) => ({ __op: 'increment', n }));

  class Timestamp {
    static now() { return { toMillis: () => Date.now(), toDate: () => new Date() } as any; }
    static fromDate(d: Date) { return { toMillis: () => d.getTime(), toDate: () => d } as any; }
    static fromMillis(ms: number) {
      return { toMillis: () => ms, toDate: () => new Date(ms), seconds: Math.floor(ms / 1000) } as any;
    }
  }

  return {
    getFirestore: vi.fn(() => ({})),
    collection,
    addDoc,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    query,
    where,
    getDocs,
    getDoc,
    onSnapshot,
    arrayUnion,
    increment,
    Timestamp,
  };
});

// --- Alias usado em alguns arquivos (ex.: Timestamp importado de '@firebase/firestore')
jest.mock('@firebase/firestore', () => {
  const addDoc = vi.fn(async () => ({ id: 'doc-1' }));
  const setDoc = vi.fn(async () => { });
  const updateDoc = vi.fn(async () => { });
  const deleteDoc = vi.fn(async () => { });

  const doc = vi.fn((_db: any, ...segments: string[]) => {
    const path = segments.filter(Boolean).join('/');
    return { __path: path };
  });

  const collection = vi.fn((_db: any, ...segments: string[]) => {
    const path = segments.filter(Boolean).join('/');
    return { __path: path };
  });

  const where = vi.fn(() => ({}));
  const query = vi.fn(() => ({}));

  const getDoc = vi.fn(async (docRef: any) => {
    const p: string = docRef?.__path ?? '';
    const id = p.split('/').pop() ?? 'doc-1';
    if (p.startsWith('public_index/')) {
      return { exists: () => false, data: () => undefined, id };
    }
    if (p.startsWith('users/')) {
      return {
        exists: () => true,
        data: () => ({ isSubscriber: true, publicNickname: 'oldnick' }),
        id,
      };
    }
    return { exists: () => false, data: () => undefined, id };
  });

  const getDocs = vi.fn(async () => ({ docs: [] as any[] }));
  const onSnapshot = vi.fn((_q: any, next?: any) => { next?.({ docs: [] }); return () => { }; });

  const serverTimestamp = vi.fn(() => new Date());
  const arrayUnion = vi.fn((...values: any[]) => ({ __op: 'arrayUnion', values }));
  const increment = vi.fn((n: number) => ({ __op: 'increment', n }));

  class Timestamp {
    static now() { return { toMillis: () => Date.now(), toDate: () => new Date() } as any; }
    static fromDate(d: Date) { return { toMillis: () => d.getTime(), toDate: () => d } as any; }
    static fromMillis(ms: number) {
      return { toMillis: () => ms, toDate: () => new Date(ms), seconds: Math.floor(ms / 1000) } as any;
    }
  }

  return {
    getFirestore: vi.fn(() => ({})),
    collection,
    addDoc,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    query,
    where,
    getDocs,
    getDoc,
    onSnapshot,
    arrayUnion,
    increment,
    Timestamp,
  };
});

// ============================================================================
// 🧪 Ambiente Angular + Jest
// ============================================================================

import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';
setupZoneTestEnv();

import 'cross-fetch/polyfill';

// TextEncoder/TextDecoder (Node)
import { TextEncoder, TextDecoder } from 'util';
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder as any;

// indexedDB (fake)
try {
  // @ts-ignore
  if (!(globalThis as any).indexedDB) {
    require('fake-indexeddb/auto');
  }
} catch { /* noop */ }

// ---- Canvas + ResizeObserver ----
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => ({
    canvas: {},
    clearRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(), createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    setTransform: vi.fn(), resetTransform: vi.fn(),
    translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(),
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(),
    stroke: vi.fn(), fill: vi.fn(), closePath: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
  }),
  configurable: true,
});
class ResizeObserverMock { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); }
(globalThis as any).ResizeObserver = ResizeObserverMock;

// ---- TestBed default ----
import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { commonTestingProviders } from './jest-stubs/test-providers';

// AngularFire (compat bridge — usado por alguns serviços)
jest.mock('@angular/fire/app', () => {
  const FirebaseApp = Symbol('FirebaseApp');
  return {
    FirebaseApp,
    initializeApp: vi.fn(() => ({})),
    provideFirebaseApp: vi.fn(() => ({ provide: FirebaseApp, useValue: {} })),
  };
});
jest.mock('@angular/fire/auth', () => {
  const { of } = require('rxjs');
  const Auth = Symbol('Auth');
  return {
    Auth,
    provideAuth: vi.fn(() => ({ provide: Auth, useValue: {} })),
    // ➜ retorne Observables:
    authState: vi.fn(() => of(null)),
    user: vi.fn(() => of(null)),
    idToken: vi.fn(() => of(null)),
    signOut: vi.fn(() => Promise.resolve()),
  };
});

// @angular/fire/firestore — reexporta mocks do firebase/firestore
jest.mock('@angular/fire/firestore', () => {
  const firebaseFs = jest.requireMock('firebase/firestore');
  const Firestore = Symbol('Firestore');
  return {
    Firestore,
    provideFirestore: vi.fn(() => ({ provide: Firestore, useValue: {} })),
    getFirestore: firebaseFs.getFirestore,
    collection: firebaseFs.collection,
    doc: firebaseFs.doc,
    query: firebaseFs.query,
    where: firebaseFs.where,
    getDocs: firebaseFs.getDocs,
    getDoc: firebaseFs.getDoc,
    setDoc: firebaseFs.setDoc,
    updateDoc: firebaseFs.updateDoc,
    deleteDoc: firebaseFs.deleteDoc,
    onSnapshot: firebaseFs.onSnapshot,
    serverTimestamp: firebaseFs.serverTimestamp,
    increment: firebaseFs.increment,
    arrayUnion: firebaseFs.arrayUnion,
    Timestamp: firebaseFs.Timestamp,
    collectionData: vi.fn(),
  };
});

// @angular/fire/storage
jest.mock('@angular/fire/storage', () => {
  const Storage = Symbol('Storage');
  return {
    Storage,
    getStorage: vi.fn(() => ({})),
    provideStorage: vi.fn(() => ({ provide: Storage, useValue: {} })),
  };
});

// @angular/fire/database — bridge total para o mock de 'firebase/database'
jest.mock('@angular/fire/database', () => {
  const firebaseDb = jest.requireMock('firebase/database');
  const Database = Symbol('Database');
  return {
    Database,
    provideDatabase: vi.fn(() => ({ provide: Database, useValue: {} })),
    getDatabase: firebaseDb.getDatabase,
    ref: firebaseDb.ref,
    set: firebaseDb.set,
    update: firebaseDb.update,
    remove: firebaseDb.remove,
    onDisconnect: firebaseDb.onDisconnect,
  };
});

// Configuração base do TestBed — usada automaticamente por specs que não configuram o TestBed
beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [RouterTestingModule, HttpClientTestingModule],
    providers: [
      provideMockStore({
        initialState: {
          user: {
            currentUser: null,
            isAuthenticated: false,
            usuarios: [],
            onlineUsers: [],
            filteredOnlineUsers: [],
          },
          chat: {
            chats: [],
            messages: [],
            loading: false,
            error: null,
          },
          friendship: {
            requests: [],
            friends: [],
            incoming: [],
            sent: [],
            loading: false,
            error: null,
          },
        },
      }),
      ...commonTestingProviders(),
      { provide: MAT_DIALOG_DATA, useValue: {} },
      { provide: MatDialogRef, useValue: { close: vi.fn() } },
      {
        provide: MatSnackBar,
        useValue: {
          open: vi.fn(() => ({
            onAction: () => of(void 0),
            afterDismissed: () => of({ dismissedByAction: false }),
          })),
        },
      },
    ],
  });
});

// ---------------- Helpers úteis globais para specs ----------------
// Permite disparar o callback mais recente registrado por onAuthStateChanged
(globalThis as any).emitAuthUser = (user: any) => {
  const auth = jest.requireMock('firebase/auth');
  const calls = (auth.onAuthStateChanged as jest.Mock).mock.calls;
  const last = calls[calls.length - 1];
  const cb = last?.[1];
  if (typeof cb === 'function') cb(user);
};
