import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '@angular/fire/auth';
import { authRestoreInitializer } from './firebase-auth-session.initializer';
import { environment } from '../../../environments/environment';
import {
  FIREBASE_AUTH_EMULATOR_PERSISTENCE_STORAGE_KEY,
  FIREBASE_AUTH_RESTORE_TIMEOUT_MS,
} from './firebase-runtime.constants';
import { markAuthInvalidUid, hasAuthInvalidUid, readAuthInvalidUid } from './auth-invalid-session-marker';
import { AuthAppBlockService } from '../services/autentication/auth/auth-app-block.service';
import { AuthSessionService } from '../services/autentication/auth/auth-session.service';
import type { PrivacyDebugLoggerService } from '../services/privacy/privacy-debug-logger.service';
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
  const auth = { currentUser: user as typeof user | null, authStateReady: vi.fn().mockResolvedValue(undefined) };
  const appBlock = new AuthAppBlockService();
  vi.spyOn(appBlock, 'set');
  vi.spyOn(appBlock, 'clear');
  const globalErrorHandler = { handleError: vi.fn() };
  const session = new AuthSessionService(auth as unknown as Auth,
    { log: vi.fn() } as unknown as PrivacyDebugLoggerService, appBlock);
  const run = authRestoreInitializer(auth as unknown as Auth,
    globalErrorHandler as unknown as GlobalErrorHandlerService,
    appBlock, session);
  return { run, user, auth, appBlock, globalErrorHandler, session };
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('authRestoreInitializer policy', () => {
  it('libera a abertura no prazo mesmo se o Firebase ainda estiver restaurando', async () => {
    vi.useFakeTimers();
    let resolveReady!: () => void;
    const t = harness(() => Promise.resolve());
    t.auth.authStateReady.mockReturnValue(new Promise<void>((resolve) => { resolveReady = resolve; }));
    const boot = t.run();

    await vi.advanceTimersByTimeAsync(FIREBASE_AUTH_RESTORE_TIMEOUT_MS);
    await boot;
    expect(t.user.reload).not.toHaveBeenCalled();
    expect(t.globalErrorHandler.handleError).toHaveBeenCalledWith(expect.objectContaining({ silent: true }));
    resolveReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.user.reload).toHaveBeenCalledOnce();
  });

  it('preserva o marcador durante uma revalidação lenta e resolve ao confirmar a mesma pessoa', async () => {
    vi.useFakeTimers();
    markAuthInvalidUid('user-a');
    let resolveReload!: () => void;
    const t = harness(() => new Promise<void>((resolve) => { resolveReload = resolve; }));
    const boot = t.run();

    await vi.advanceTimersByTimeAsync(FIREBASE_AUTH_RESTORE_TIMEOUT_MS);
    await boot;
    expect(hasAuthInvalidUid('user-a')).toBe(true);
    resolveReload();
    await vi.advanceTimersByTimeAsync(0);
    expect(hasAuthInvalidUid('user-a')).toBe(false);
  });

  it('ignora invalidação que chega após o encerramento voluntário da sessão', async () => {
    vi.useFakeTimers();
    let rejectReload!: (error: unknown) => void;
    const t = harness(() => new Promise<void>((_, reject) => { rejectReload = reject; }));
    const boot = t.run();

    await vi.advanceTimersByTimeAsync(FIREBASE_AUTH_RESTORE_TIMEOUT_MS);
    await boot;
    t.session.beginTermination();
    t.auth.currentUser = null;
    t.session.endTermination();
    rejectReload(Object.assign(new Error('expired'), { code: 'auth/user-token-expired' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(hasAuthInvalidUid('user-a')).toBe(false);
  });

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
    t.auth.currentUser = { ...t.user, uid: 'user-b' };
    rejectReload(Object.assign(new Error('expired'), { code: 'auth/user-token-expired' }));
    await promise;
    expect(t.appBlock.set).not.toHaveBeenCalled();
    expect(hasAuthInvalidUid('user-a')).toBe(false);
  });

  it.each([
    ['auth/user-disabled', 'session-disabled'],
    ['auth/user-token-expired', 'session-expired'],
  ])('preserva a causa %s quando o SDK já limpou o usuário', async (code, reason) => {
    const t = harness(async () => {
      t.auth.currentUser = null;
      throw Object.assign(new Error('SDK invalidation'), { code });
    });
    await t.run();
    expect(t.appBlock.invalidationSnapshot).toEqual({ uid: 'user-a', reason });
    expect(readAuthInvalidUid('user-a')).toBe(reason);
    expect(t.appBlock.snapshot).toBeNull();
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
