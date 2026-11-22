import {
  BehaviorSubject,
  EMPTY,
  NEVER,
  Observable,
  Subject,
  defer,
  firstValueFrom,
  from,
  of,
  throwError,
} from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readPendingLogout, savePendingLogout } from '@core/firebase/pending-logout';
import { LogoutService } from './logout.service';

type PushMode = 'success' | 'error' | 'empty' | 'never';
type PushStateMode = 'active' | 'never';
type CleanupMode = 'success' | 'never';
type SignOutMode = 'success' | 'error';

interface HarnessOptions {
  presenceMode?: CleanupMode;
  pushMode?: PushMode;
  pushStateMode?: PushStateMode;
  cacheMode?: CleanupMode;
  signOutMode?: SignOutMode;
}

const originalNotification = Object.getOwnPropertyDescriptor(
  globalThis,
  'Notification'
);

function pendingSignOut() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { result$: from(promise), resolve, reject };
}

function createHarness(options: HarnessOptions = {}) {
  const presenceMode = options.presenceMode ?? 'success';
  const pushMode = options.pushMode ?? 'success';
  const pushStateMode = options.pushStateMode ?? 'active';
  const cacheMode = options.cacheMode ?? 'success';
  const signOutMode = options.signOutMode ?? 'success';
  const calls: string[] = [];
  let terminating = false;

  const auth = {
    currentUser: { uid: 'user-a' } as { uid: string } | null,
  };

  const router = {
    url: '/home',
    routerState: { snapshot: { root: {} } },
    events: new Subject<unknown>(),
    navigate: vi.fn(() => {
      calls.push('navigate');
      return Promise.resolve(true);
    }),
  };

  const sessionExit = {
    markSignedOut: vi.fn(() => { calls.push('session:signed-out'); }),
    openAfterLogout$: vi.fn(() => defer(() => {
      calls.push('navigate');
      return of(void 0);
    })),
  };
  const outletContexts = { getContext: vi.fn(() => null as unknown) };
  const dialog = { open: vi.fn() };

  const presence = {
    stop$: vi.fn(() =>
      defer(() => {
        calls.push('presence');

        if (presenceMode === 'never') {
          return NEVER;
        }

        return of(void 0);
      })
    ),
  };

  const geolocation = {
    stopTracking: vi.fn(() => {
      calls.push('geolocation');
    }),
  };

  const pushNotifications = {
    state$: pushStateMode === 'never' ? NEVER : of('active' as const),
    get currentStateSnapshot() {
      if (pushStateMode === 'never') calls.push('push:snapshot');
      return 'active' as const;
    },
    deactivate$: vi.fn(() =>
      defer(() => {
        calls.push('push');

        if (pushMode === 'error') {
          return throwError(() => new Error('push unavailable'));
        }

        if (pushMode === 'empty') {
          return EMPTY;
        }

        if (pushMode === 'never') {
          return NEVER;
        }

        return of('inactive' as const);
      })
    ),
    activate$: vi.fn(() =>
      defer(() => {
        calls.push('push:restore');
        return of('active' as const);
      })
    ),
  };

  const currentUserStore = {
    clear: vi.fn(),
  };

  const appBlock = {
    clear: vi.fn(),
  };

  const authSession = {
    authUser$: new BehaviorSubject<{ uid: string } | null>(auth.currentUser),
    beginTermination: vi.fn(() => {
      terminating = true;
      calls.push('session:begin');
    }),
    endTermination: vi.fn(() => {
      terminating = false;
      calls.push('session:end');
    }),
    get isTerminatingSnapshot() {
      return terminating;
    },
  };

  const applicationError = {
    report: vi.fn(),
  };

  const privacyDebug = {
    log: vi.fn(),
  };

  const cache = {
    clearSensitiveSessionCache$: vi.fn(() =>
      defer(() => {
        calls.push('cache');

        if (cacheMode === 'never') {
          return NEVER;
        }

        return of(void 0);
      })
    ),
  };

  const service = new LogoutService(
    auth as any,
    router as any,
    presence as any,
    geolocation as any,
    pushNotifications as any,
    currentUserStore as any,
    appBlock as any,
    authSession as any,
    applicationError as any,
    {} as any,
    privacyDebug as any,
    cache as any,
    outletContexts as any,
    dialog as any,
    sessionExit as any
  );

  const executeSignOut = vi.fn((mode: string): Observable<void> =>
    defer(() => {
      calls.push(`signout:${mode}`);

      if (signOutMode === 'error' && mode === 'strict') {
        return throwError(() => new Error('signout unavailable'));
      }

      auth.currentUser = null;
      return of(void 0);
    })
  );
  (service as any).executeSignOut$ = executeSignOut;

  return {
    service,
    auth,
    calls,
    router,
    presence,
    pushNotifications,
    cache,
    sessionExit,
    outletContexts,
    dialog,
    currentUserStore,
    appBlock,
    authSession,
    applicationError,
    executeSignOut,
  };
}

afterEach(() => {
  vi.useRealTimers();

  if (originalNotification) {
    Object.defineProperty(globalThis, 'Notification', originalNotification);
  } else {
    Reflect.deleteProperty(globalThis, 'Notification');
  }
});

describe('LogoutService global session lifecycle', () => {
  it('encerra recursos, sessão e dados locais em uma única ordem canônica', async () => {
    const {
      service,
      calls,
      pushNotifications,
      currentUserStore,
      appBlock,
      authSession,
    } = createHarness();

    await firstValueFrom(service.logout$());

    expect(calls).toEqual([
      'session:begin',
      'geolocation',
      'presence',
      'push',
      'signout:strict',
      'session:signed-out',
      'cache',
      'navigate',
      'session:end',
    ]);
    expect(pushNotifications.deactivate$).toHaveBeenCalledTimes(1);
    expect(currentUserStore.clear).toHaveBeenCalledTimes(1);
    expect(appBlock.clear).toHaveBeenCalledTimes(1);
    expect(authSession.beginTermination).toHaveBeenCalledTimes(1);
    expect(authSession.endTermination).toHaveBeenCalledTimes(1);
  });

  it('compartilha a mesma operação entre chamadores concorrentes', async () => {
    const { service, calls, auth } = createHarness();
    const signOutGate = new Subject<void>();

    const executeSignOut = vi.fn((mode: string) =>
      defer(() => {
        calls.push(`signout:${mode}`);
        return signOutGate.asObservable();
      })
    );
    (service as any).executeSignOut$ = executeSignOut;

    const first$ = service.logout$();
    const second$ = service.logout$();
    expect(second$).toBe(first$);

    const firstDone = firstValueFrom(first$);
    const secondDone = firstValueFrom(second$);

    expect(executeSignOut).toHaveBeenCalledTimes(1);

    auth.currentUser = null;
    signOutGate.next();
    signOutGate.complete();

    await Promise.all([firstDone, secondDone]);
    expect(executeSignOut).toHaveBeenCalledTimes(1);
  });

  it('usa snapshot de Web Push sem aguardar emissões para mascarar a sessão', async () => {
    const { service, calls, authSession, applicationError } =
      createHarness({ pushStateMode: 'never' });

    await firstValueFrom(service.logout$());

    expect(calls.slice(0, 3)).toEqual([
      'push:snapshot',
      'session:begin',
      'geolocation',
    ]);
    expect(calls).toContain('signout:strict');
    expect(calls).toContain('session:end');
    expect(authSession.beginTermination).toHaveBeenCalledTimes(1);
    expect(applicationError.report).not.toHaveBeenCalled();
  });

  it('restaura a sessão operacional e Web Push se o signOut estrito falhar', async () => {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission: 'granted' },
    });

    const {
      service,
      calls,
      auth,
      pushNotifications,
      currentUserStore,
      applicationError,
    } = createHarness({ signOutMode: 'error' });

    await expect(firstValueFrom(service.logout$())).rejects.toThrow(
      'signout unavailable'
    );

    expect(auth.currentUser?.uid).toBe('user-a');
    expect(calls).toEqual([
      'session:begin',
      'geolocation',
      'presence',
      'push',
      'signout:strict',
      'session:end',
      'push:restore',
    ]);
    expect(pushNotifications.activate$).toHaveBeenCalledTimes(1);
    expect(currentUserStore.clear).not.toHaveBeenCalled();
    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'signout unavailable',
      }),
      {
        feature: 'auth',
        operation: 'logout',
        fallbackMessage: 'Não foi possível concluir uma etapa interna do encerramento da sessão.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'LogoutService',
          phase: 'logout',
          sessionRestored: true,
        },
      }
    );
  });

  it('mostra a demora sem duplicar signOut e aceita a confirmação tardia do SDK', async () => {
    vi.useFakeTimers();
    const t = createHarness();
    const sdk = pendingSignOut();
    t.executeSignOut.mockReturnValue(sdk.result$);
    const feedback: Array<string | null> = [];
    const listener = t.service.voluntaryLogoutStatus$.subscribe((phase) => feedback.push(phase));
    const done = firstValueFrom(t.service.logout$());

    expect(feedback.at(-1)).toBe('ending');
    t.auth.currentUser = null; // snapshot em memória muda antes de concluir a persistência
    await vi.advanceTimersByTimeAsync(10_000);
    expect(feedback.at(-1)).toBe('delayed');
    expect(readPendingLogout()).toBe('user-a');
    expect(t.authSession.isTerminatingSnapshot).toBe(true);
    expect(t.sessionExit.markSignedOut).not.toHaveBeenCalled();
    expect(t.cache.clearSensitiveSessionCache$).not.toHaveBeenCalled();

    t.service.retryVoluntaryLogout();
    const second = firstValueFrom(t.service.logout$());
    expect(t.executeSignOut).toHaveBeenCalledOnce();
    sdk.resolve();
    await Promise.all([done, second]);

    expect(t.sessionExit.markSignedOut).toHaveBeenCalledOnce();
    expect(t.sessionExit.openAfterLogout$).toHaveBeenCalledOnce();
    expect(t.authSession.isTerminatingSnapshot).toBe(false);
    expect(feedback).toEqual([null, 'ending', 'delayed', null]);
    expect(readPendingLogout()).toBeNull();
    listener.unsubscribe();
  });

  it('oferece nova tentativa após rejeição tardia da mesma sessão e preserva o rascunho', async () => {
    vi.useFakeTimers();
    const t = createHarness();
    const draft = openDraft(t);
    const sdk = pendingSignOut();
    t.executeSignOut.mockReturnValueOnce(sdk.result$);
    const feedback: Array<string | null> = [];
    const listener = t.service.voluntaryLogoutStatus$.subscribe((phase) => feedback.push(phase));
    const result = expect(firstValueFrom(t.service.logout$())).rejects.toThrow('persistência indisponível');
    draft.answer.next(true);
    await vi.advanceTimersByTimeAsync(10_000);
    sdk.reject(new Error('persistência indisponível'));
    await result;

    expect(t.authSession.isTerminatingSnapshot).toBe(false);
    expect(draft.discardUnsavedChanges).not.toHaveBeenCalled();
    expect(feedback.at(-1)).toBe('failed');

    t.service.retryVoluntaryLogout();
    expect(t.executeSignOut).toHaveBeenCalledOnce();
    draft.answer.next(true);
    expect(t.executeSignOut).toHaveBeenCalledTimes(2);
    expect(draft.discardUnsavedChanges).toHaveBeenCalledOnce();
    expect(feedback.at(-1)).toBeNull();
    listener.unsubscribe();
  });

  it('mantém o modo protegido se o SDK rejeita depois de mudar o snapshot para null', async () => {
    const t = createHarness();
    const draft = openDraft(t);
    const feedback: Array<string | null> = [];
    const listener = t.service.voluntaryLogoutStatus$.subscribe((phase) => feedback.push(phase));
    t.executeSignOut.mockReturnValueOnce(defer(() => {
      t.auth.currentUser = null;
      return throwError(() => new Error('persistência indisponível'));
    }));
    const result = expect(firstValueFrom(t.service.logout$())).rejects.toThrow('persistência indisponível');
    draft.answer.next(true);
    await result;

    expect(feedback.at(-1)).toBe('unconfirmed');
    expect(t.authSession.isTerminatingSnapshot).toBe(true);
    expect(t.sessionExit.markSignedOut).not.toHaveBeenCalled();
    expect(draft.discardUnsavedChanges).not.toHaveBeenCalled();
    t.service.retryVoluntaryLogout();
    t.service.logout();
    expect(t.executeSignOut).toHaveBeenCalledOnce();
    listener.unsubscribe();
  });

  it('mantém a sessão restaurada protegida enquanto retoma o signOut', async () => {
    const t = createHarness();
    savePendingLogout('user-a');
    const sdk = pendingSignOut();
    t.executeSignOut.mockReturnValueOnce(sdk.result$);
    const done = firstValueFrom(t.service.invalidateRestoredSessionForBootstrap$());
    expect(t.authSession.isTerminatingSnapshot).toBe(true);
    expect(readPendingLogout()).toBe('user-a');
    t.auth.currentUser = null;
    sdk.resolve();
    await done;
    expect(readPendingLogout()).toBeNull();
    expect(t.authSession.isTerminatingSnapshot).toBe(false);
  });

  it('ignora a conclusão da operação anterior quando outra conta já está ativa', async () => {
    const t = createHarness();
    const draft = openDraft(t);
    const sdk = pendingSignOut();
    t.executeSignOut.mockReturnValueOnce(sdk.result$);
    const done = firstValueFrom(t.service.logout$(), { defaultValue: 'interrompido' });
    draft.answer.next(true);

    t.auth.currentUser = { uid: 'user-b' };
    t.authSession.authUser$.next(t.auth.currentUser);
    sdk.resolve();
    expect(await done).toBe('interrompido');

    expect(t.auth.currentUser?.uid).toBe('user-b');
    expect(t.authSession.isTerminatingSnapshot).toBe(false);
    expect(draft.discardUnsavedChanges).not.toHaveBeenCalled();
    expect(t.sessionExit.markSignedOut).not.toHaveBeenCalled();
    expect(t.cache.clearSensitiveSessionCache$).not.toHaveBeenCalled();
  });

  it('falha do Web Push é reportada silenciosamente e não bloqueia o logout', async () => {
    const { service, calls, applicationError } = createHarness({
      pushMode: 'error',
    });

    await firstValueFrom(service.logout$());

    expect(calls).toContain('signout:strict');
    expect(calls).toContain('cache');
    expect(calls).toContain('navigate');
    expect(applicationError.report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'push unavailable',
      }),
      {
        feature: 'auth',
        operation: 'deactivatePushBestEffort$',
        fallbackMessage:
          'Não foi possível concluir uma etapa interna do encerramento da sessão.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'LogoutService',
          phase: 'deactivatePushBestEffort$',
        },
      }
    );
  });

  it('Observable vazio do cleanup de Web Push não encerra a cadeia de logout', async () => {
    const { service, calls } = createHarness({ pushMode: 'empty' });

    await firstValueFrom(service.logout$());

    expect(calls).toContain('signout:strict');
    expect(calls).toContain('navigate');
  });

  it('cleanups best-effort que nunca completam não prendem o logout', async () => {
    vi.useFakeTimers();

    const { service, calls, applicationError } = createHarness({
      presenceMode: 'never',
      pushMode: 'never',
      cacheMode: 'never',
    });

    const done = firstValueFrom(service.logout$());

    expect(calls).toContain('push');
    expect(calls).not.toContain('signout:strict');
    await vi.runAllTimersAsync();
    await done;

    expect(calls).toEqual([
      'session:begin',
      'geolocation',
      'presence',
      'push',
      'signout:strict',
      'session:signed-out',
      'cache',
      'navigate',
      'session:end',
    ]);
    expect(applicationError.report).toHaveBeenCalledTimes(3);
    expect(applicationError.report).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: '[LogoutService] best-effort cleanup timeout',
      }),
      expect.objectContaining({
        feature: 'auth',
        operation: 'stopPresenceBestEffort$',
        presentation: { surface: 'none', severity: 'error' },
      })
    );
    expect(applicationError.report).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: '[LogoutService] best-effort cleanup timeout',
      }),
      expect.objectContaining({
        feature: 'auth',
        operation: 'deactivatePushBestEffort$',
        presentation: { surface: 'none', severity: 'error' },
      })
    );
    expect(applicationError.report).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        message: '[LogoutService] best-effort cleanup timeout',
      }),
      expect.objectContaining({
        feature: 'auth',
        operation: 'clearLocalSessionDataBestEffort$',
        presentation: { surface: 'none', severity: 'error' },
      })
    );
  });

  function openDraft(harness: ReturnType<typeof createHarness>) {
    const discardUnsavedChanges = vi.fn(() => {
      harness.calls.push('draft:discard');
    });
    const answer = new Subject<boolean>();
    const leaf = {
      outlet: { isActivated: true, component: { hasUnsavedChanges: () => true, discardUnsavedChanges } },
      children: { getContext: () => null },
    };
    harness.outletContexts.getContext.mockReturnValue({
      outlet: { isActivated: true, component: {} },
      children: { getContext: () => leaf },
    });
    const close = vi.fn();
    harness.dialog.open.mockReturnValue({ afterClosed: () => answer, close });
    return { discardUnsavedChanges, answer, close };
  }

  it('aguarda a escolha sobre o formulário antes do logout e preserva tudo ao cancelar', async () => {
    const t = createHarness();
    const draft = openDraft(t);
    const result = firstValueFrom(t.service.logout$(), { defaultValue: 'cancelled' });
    expect(t.dialog.open).toHaveBeenCalledOnce();
    expect(t.authSession.beginTermination).not.toHaveBeenCalled();
    draft.answer.next(false);

    expect(await result).toBe('cancelled');
    expect(t.auth.currentUser?.uid).toBe('user-a');
    expect(t.executeSignOut).not.toHaveBeenCalled();
    expect(t.sessionExit.markSignedOut).not.toHaveBeenCalled();
    expect(draft.discardUnsavedChanges).not.toHaveBeenCalled();
  });

  it('descarta o rascunho confirmado somente depois que a credencial saiu', async () => {
    const t = createHarness();
    const draft = openDraft(t);
    const result = firstValueFrom(t.service.logout$());
    expect(draft.discardUnsavedChanges).not.toHaveBeenCalled();
    draft.answer.next(true);
    await result;

    expect(t.calls).toEqual([
      'session:begin', 'geolocation', 'presence', 'push', 'signout:strict',
      'session:signed-out', 'draft:discard', 'cache', 'navigate', 'session:end',
    ]);
  });

  it('preserva o rascunho confirmado se a credencial continuar ativa', async () => {
    const t = createHarness({ signOutMode: 'error' });
    const draft = openDraft(t);
    const result = expect(firstValueFrom(t.service.logout$())).rejects.toThrow('signout unavailable');
    draft.answer.next(true);
    await result;
    expect(draft.discardUnsavedChanges).not.toHaveBeenCalled();
    expect(t.sessionExit.markSignedOut).not.toHaveBeenCalled();
  });

  it('ignora a decisão de descartar rascunho quando o usuário mudou', async () => {
    const t = createHarness();
    const draft = openDraft(t);
    const result = firstValueFrom(t.service.logout$(), { defaultValue: 'cancelled' });
    t.auth.currentUser = { uid: 'new-user' };
    draft.answer.next(true);

    expect(await result).toBe('cancelled');
    expect(t.executeSignOut).not.toHaveBeenCalled();
    expect(draft.discardUnsavedChanges).not.toHaveBeenCalled();
  });

  it('fecha a confirmação de saída se a sessão se perder enquanto aguarda', async () => {
    const t = createHarness();
    const draft = openDraft(t);
    const result = firstValueFrom(t.service.logout$(), { defaultValue: 'cancelled' });
    t.auth.currentUser = null;
    t.authSession.authUser$.next(null);

    expect(await result).toBe('cancelled');
    expect(draft.close).toHaveBeenCalledOnce();
    expect(draft.discardUnsavedChanges).not.toHaveBeenCalled();
    expect(t.executeSignOut).not.toHaveBeenCalled();
  });

  it('limita a espera ao restaurar Web Push depois de um signOut rejeitado', async () => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission: 'granted' },
    });
    const t = createHarness({ signOutMode: 'error' });
    t.pushNotifications.activate$.mockReturnValue(NEVER);
    const result = expect(firstValueFrom(t.service.logout$())).rejects.toThrow('signout unavailable');

    expect(t.authSession.isTerminatingSnapshot).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    expect(t.applicationError.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'restorePushAfterFailedSignOutBestEffort$' })
    );
  });

  it('hard signout usa o mesmo lifecycle e centraliza o aviso de sessão encerrada', async () => {
    const { service, calls, applicationError, authSession } = createHarness();

    await firstValueFrom(service.hardSignOutToWelcome$('auth-invalid'));

    expect(calls).toEqual([
      'session:begin',
      'geolocation',
      'presence',
      'push',
      'signout:best-effort',
      'cache',
      'navigate',
      'session:end',
    ]);
    expect(applicationError.report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Hard sign-out initiated',
      }),
      {
        feature: 'auth',
        operation: 'hardSignOutToWelcome',
        fallbackMessage:
          'Sua sessão foi encerrada. Faça login novamente.',
        presentation: { surface: 'snackbar', severity: 'error' },
        metadata: {
          scope: 'LogoutService',
          reason: 'auth-invalid',
          expectedTermination: true,
        },
      }
    );
    expect(authSession.beginTermination).toHaveBeenCalledTimes(1);
    expect(authSession.endTermination).toHaveBeenCalledTimes(1);
  });

  it('não apresenta aviso de hard signout durante o fluxo de registro', async () => {
    const { service, router, applicationError } = createHarness();
    router.url = '/register/welcome';

    await firstValueFrom(service.hardSignOutToWelcome$('auth-invalid'));

    expect(applicationError.report).not.toHaveBeenCalled();
  });
});
