import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '@angular/fire/auth';
import { authRestoreInitializer } from './firebase-auth-session.initializer';
import { environment } from '../../../environments/environment';
import { FIREBASE_AUTH_EMULATOR_PERSISTENCE_STORAGE_KEY } from './firebase-runtime.constants';
import { markAuthInvalidUid, hasAuthInvalidUid } from './auth-invalid-session-marker';
import type { AuthAppBlockService } from '../services/autentication/auth/auth-app-block.service';
import type { GlobalErrorHandlerService } from '../services/error-handler/global-error-handler.service';

function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function harness(reload: () => Promise<void>) {
  const user = { uid: 'user-a', emailVerified: true, reload: vi.fn(reload) };
  const auth = { currentUser: user, authStateReady: vi.fn().mockResolvedValue(undefined) };
  const appBlock = { snapshot: null as 'auth-invalid' | null, set: vi.fn(), clear: vi.fn() };
  appBlock.set.mockImplementation((reason: 'auth-invalid') => { appBlock.snapshot = reason; });
  appBlock.clear.mockImplementation(() => { appBlock.snapshot = null; });
  const globalErrorHandler = { handleError: vi.fn() };
  const run = authRestoreInitializer(auth as unknown as Auth,
    globalErrorHandler as unknown as GlobalErrorHandlerService,
    appBlock as unknown as AuthAppBlockService);
  return { run, user, auth, appBlock, globalErrorHandler };
}

// Cada teste configura o ambiente real sem mockar imports relativos.
// Restauramos sempre os valores para nao contaminar outras suites.
const originalEnvironment = {
  production: environment.production,
  useEmulators: environment.useEmulators,
  emulators: environment.emulators,
};

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  environment.production = false;
  environment.useEmulators = false;
  environment.emulators = undefined;
});

afterEach(() => {
  environment.production = originalEnvironment.production;
  environment.useEmulators = originalEnvironment.useEmulators;
  environment.emulators = originalEnvironment.emulators;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('authRestoreInitializer policy', () => {
  it('revalida no Cloud sem encerrar a sessao', async () => {
    const t = harness(() => Promise.resolve());
    await t.run();
    expect(t.user.reload).toHaveBeenCalledOnce();
    expect(t.appBlock.set).not.toHaveBeenCalled();
    expect(t.globalErrorHandler.handleError).not.toHaveBeenCalled();
  });

  it('bloqueia e persiste credencial invalida sem signOut', async () => {
    const error = Object.assign(new Error('disabled'), { code: 'auth/user-disabled' });
    const t = harness(() => Promise.reject(error));
    await t.run();
    expect(t.appBlock.set).toHaveBeenCalledWith('auth-invalid');
    expect(hasAuthInvalidUid('user-a')).toBe(true);
  });

  it('preserva bloqueio apos refresh sem rede', async () => {
    markAuthInvalidUid('user-a');
    const error = Object.assign(new Error('offline'), { code: 'auth/network-request-failed' });
    const t = harness(() => Promise.reject(error));
    await t.run();
    expect(t.appBlock.set).toHaveBeenCalledWith('auth-invalid');
    expect(hasAuthInvalidUid('user-a')).toBe(true);
  });

  it('falha de rede sem bloqueio anterior nao derruba a identidade', async () => {
    const error = Object.assign(new Error('offline'), { code: 'auth/network-request-failed' });
    const t = harness(() => Promise.reject(error));
    await t.run();
    expect(t.appBlock.set).not.toHaveBeenCalled();
    expect(hasAuthInvalidUid('user-a')).toBe(false);
  });

  it('remove bloqueio apenas depois da revalidacao bem-sucedida', async () => {
    markAuthInvalidUid('user-a');
    const t = harness(() => Promise.resolve());
    await t.run();
    expect(t.appBlock.set).toHaveBeenCalledWith('auth-invalid');
    expect(t.appBlock.clear).toHaveBeenCalledOnce();
    expect(hasAuthInvalidUid('user-a')).toBe(false);
  });

  it('nao aplica resposta atrasada da conta anterior', async () => {
    let rejectReload: (error: Error) => void = () => {};
    const pending = new Promise<void>((_, reject) => { rejectReload = reject; });
    const t = harness(() => pending);
    const promise = t.run();
    await vi.waitFor(() => expect(t.user.reload).toHaveBeenCalledOnce());
    t.auth.currentUser.uid = 'user-b';
    rejectReload(Object.assign(new Error('expired'), { code: 'auth/user-token-expired' }));
    await promise;
    expect(t.appBlock.set).not.toHaveBeenCalled();
    expect(hasAuthInvalidUid('user-a')).toBe(false);
  });

  it('bloqueia ghost no modo QA memory sem signOut', async () => {
    environment.useEmulators = true;
    environment.emulators = {
      auth: { host: '127.0.0.1', port: 9099 },
    };
    window.localStorage.setItem(FIREBASE_AUTH_EMULATOR_PERSISTENCE_STORAGE_KEY, 'memory');
    const t = harness(() => Promise.resolve());
    await t.run();
    expect(t.user.reload).not.toHaveBeenCalled();
    expect(t.appBlock.set).toHaveBeenCalledWith('auth-invalid');
    expect(hasAuthInvalidUid('user-a')).toBe(true);
  });
});
