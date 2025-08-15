//src\test\setup-jest.ts
// ============================================================================
// 🔥 Mocks de Firebase (DEVEM vir antes de qualquer import)
// ============================================================================

// firebase/app
jest.mock('firebase/app', () => {
  const app = { name: '[DEFAULT]' };
  return {
    initializeApp: jest.fn(() => app),
    getApps: jest.fn(() => []), // default: força init; em testes específicos você pode mockar para [app]
    getApp: jest.fn(() => app),
  };
});

// firebase/auth
jest.mock('firebase/auth', () => {
  const onAuthStateChanged = jest.fn((_auth: any, cb: any) => {
    // em testes você pode sobrescrever esse mock para emitir usuário
    cb?.(null);
    return () => { };
  });
  return {
    getAuth: jest.fn(() => ({
      currentUser: null,
    })),
    onAuthStateChanged,
    signOut: jest.fn(() => Promise.resolve()),
    signInWithPopup: jest.fn(() => Promise.resolve({ user: { uid: 'uid-x' } })),
    createUserWithEmailAndPassword: jest.fn(() => Promise.resolve({ user: { uid: 'uid-x' } })),
    sendPasswordResetEmail: jest.fn(() => Promise.resolve()),
    updateProfile: jest.fn(() => Promise.resolve()),
    GoogleAuthProvider: function GoogleAuthProvider() { },
  };
});

// firebase/database
jest.mock('firebase/database', () => {
  const set = jest.fn(() => Promise.resolve());
  const ref = jest.fn(() => ({}));
  const onDisconnect = jest.fn(() => ({
    set: jest.fn(() => Promise.resolve()),
  }));
  const getDatabase = jest.fn(() => ({
    ref,
    set,
    onDisconnect,
  }));
  return {
    getDatabase,
    ref,
    set,
    onDisconnect,
  };
});

// firebase/firestore
jest.mock('firebase/firestore', () => {
  const addDoc = jest.fn(async () => ({ id: 'doc-1' }));
  const setDoc = jest.fn(async () => { });
  const updateDoc = jest.fn(async () => { });
  const deleteDoc = jest.fn(async () => { });
  const getDoc = jest.fn(async () => ({ exists: () => false, data: () => undefined, id: 'doc-1' }));
  const getDocs = jest.fn(async () => ({ docs: [] as any[] }));
  const where = jest.fn(() => ({}));
  const query = jest.fn(() => ({}));
  const collection = jest.fn(() => ({}));
  const doc = jest.fn(() => ({}));
  const onSnapshot = jest.fn((_q: any, next?: any) => {
    // emite coleção vazia
    next?.({ docs: [] });
    return () => { };
  });
  const serverTimestamp = jest.fn(() => new Date());
  const arrayUnion = (...values: any[]) => ({ __op: 'arrayUnion', values });
  const increment = (n: number) => ({ __op: 'increment', n });

  class Timestamp {
    static now() { return { toMillis: () => Date.now() }; }
    static fromDate(d: Date) { return { toDate: () => d }; }
  }

  return {
    getFirestore: jest.fn(() => ({})),
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

// Alias usado em alguns arquivos (ex.: Timestamp importado de '@firebase/firestore')
jest.mock('@firebase/firestore', () => {
  const addDoc = jest.fn(async () => ({ id: 'doc-1' }));
  const setDoc = jest.fn(async () => { });
  const updateDoc = jest.fn(async () => { });
  const deleteDoc = jest.fn(async () => { });
  const getDoc = jest.fn(async () => ({ exists: () => false, data: () => undefined, id: 'doc-1' }));
  const getDocs = jest.fn(async () => ({ docs: [] as any[] }));
  const where = jest.fn(() => ({}));
  const query = jest.fn(() => ({}));
  const collection = jest.fn(() => ({}));
  const doc = jest.fn(() => ({}));
  const onSnapshot = jest.fn((_q: any, next?: any) => {
    next?.({ docs: [] });
    return () => { };
  });
  const serverTimestamp = jest.fn(() => new Date());
  const arrayUnion = (...values: any[]) => ({ __op: 'arrayUnion', values });
  const increment = (n: number) => ({ __op: 'increment', n });

  class Timestamp {
    static now() { return { toMillis: () => Date.now() }; }
    static fromDate(d: Date) { return { toDate: () => d }; }
  }

  return {
    getFirestore: jest.fn(() => ({})),
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
// Ambiente Angular/Jest
// ============================================================================

// src/test/setup-jest.ts
import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';
setupZoneTestEnv();
import 'cross-fetch/polyfill';

// TextEncoder/TextDecoder
import { TextEncoder, TextDecoder } from 'util';
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder as any;

// indexedDB
try {
  // @ts-ignore
  if (!(globalThis as any).indexedDB) {
    require('fake-indexeddb/auto');
  }
} catch { }

// ---- CANVAS + ResizeObserver ----
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => ({
    canvas: {},
    clearRect: jest.fn(), drawImage: jest.fn(), fillRect: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: jest.fn(), createImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
    setTransform: jest.fn(), resetTransform: jest.fn(),
    translate: jest.fn(), scale: jest.fn(), rotate: jest.fn(),
    save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(),
    moveTo: jest.fn(), lineTo: jest.fn(), arc: jest.fn(),
    stroke: jest.fn(), fill: jest.fn(), closePath: jest.fn(),
  }),
  configurable: true,
});

class ResizeObserverMock { observe = jest.fn(); unobserve = jest.fn(); disconnect = jest.fn(); }
(globalThis as any).ResizeObserver = ResizeObserverMock;

// ---- TestBed default ----
import { TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { commonTestingProviders } from './jest-stubs/test-providers';

// AngularFire (não usados diretamente pelos seus serviços, mas mantidos por compat)
jest.mock('@angular/fire/app', () => ({
  initializeApp: jest.fn(() => ({})),
  provideFirebaseApp: jest.fn(() => ({ provide: 'FIREBASE_APP', useValue: {} })),
}));
jest.mock('@angular/fire/auth', () => ({
  getAuth: jest.fn(() => ({})),
  provideAuth: jest.fn(() => ({ provide: 'FIREBASE_AUTH', useValue: {} })),
}));
jest.mock('@angular/fire/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  provideFirestore: jest.fn(() => ({ provide: 'FIREBASE_FIRESTORE', useValue: {} })),
  collection: jest.fn(),
  doc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDocs: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  collectionData: jest.fn(),
  increment: jest.fn(),
  arrayUnion: jest.fn(),
}));
jest.mock('@angular/fire/storage', () => ({
  getStorage: jest.fn(() => ({})),
  provideStorage: jest.fn(() => ({ provide: 'FIREBASE_STORAGE', useValue: {} })),
}));

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [RouterTestingModule, HttpClientTestingModule],
    providers: [
      provideMockStore({ initialState: {} }),
      ...commonTestingProviders(),
      { provide: MAT_DIALOG_DATA, useValue: {} },
      { provide: MatDialogRef, useValue: { close: jest.fn() } },
    ],
  });
});

// ---------------- Consoles: silenciar por padrão ----------------

const __ORIGINAL_CONSOLE__ = {
  log: console.log,
  info: console.info,
  debug: console.debug,
  warn: console.warn,
  error: console.error,
};

// Env flags:
// - JEST_SILENCE_CONSOLE: controla log/info/debug (default: true)
// - JEST_SILENCE_WARN: controla warn (default: true)
// - JEST_CONSOLE_ALLOW: whitelista padrões (separados por "|")
// - FAIL_ON_CONSOLE_ERROR: lança erro ao ocorrer console.error (default: false)
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

// helpers para habilitar logs em um teste
(globalThis as any).allowConsole = (patterns: string | string[]) => {
  const arr = Array.isArray(patterns) ? patterns : [patterns];
  ALLOW_LIST = [...ALLOW_LIST, ...arr.filter(Boolean)];
};
(globalThis as any).resetConsoleAllow = () => {
  ALLOW_LIST = (process.env['JEST_CONSOLE_ALLOW'] ?? '')
    .split('|').map(s => s.trim()).filter(Boolean);
};

beforeAll(() => {
  if (SILENCE_STD) {
    jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      if (matchesAllowList(args)) __ORIGINAL_CONSOLE__.log(...args);
    });
    jest.spyOn(console, 'info').mockImplementation((...args: any[]) => {
      if (matchesAllowList(args)) __ORIGINAL_CONSOLE__.info(...args);
    });
    jest.spyOn(console, 'debug').mockImplementation((...args: any[]) => {
      if (matchesAllowList(args)) __ORIGINAL_CONSOLE__.debug(...args);
    });
  }
  if (SILENCE_WARN) {
    jest.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
      if (matchesAllowList(args)) __ORIGINAL_CONSOLE__.warn(...args);
    });
  } else {
    jest.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
      if (matchesAllowList(args)) return __ORIGINAL_CONSOLE__.warn(...args);
      __ORIGINAL_CONSOLE__.warn('[WARN nos testes]', ...args);
    });
  }

  jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    if (matchesAllowList(args)) return __ORIGINAL_CONSOLE__.error(...args);
    __ORIGINAL_CONSOLE__.error('[ERROR nos testes]', ...args);
    if (FAIL_ON_ERROR) {
      const msg = args.map(stringifySafe).join(' ');
      throw new Error(`console.error disparado durante o teste: ${msg}`);
    }
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});
