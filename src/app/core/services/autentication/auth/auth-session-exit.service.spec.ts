import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type UrlTree } from '@angular/router';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authInvalidMarkerKey, markAuthInvalidUid } from '@core/firebase/auth-invalid-session-marker';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { AuthAppBlockService } from './auth-app-block.service';
import { AuthRouteContextService, type AuthRouteContext } from './auth-route-context.service';
import { AuthSessionExitService } from './auth-session-exit.service';
import { AuthSessionService } from './auth-session.service';

describe('AuthSessionExitService', () => {
  const protectedRoute: AuthRouteContext = {
    currentUrl: '/dashboard/principal', navPath: '/dashboard/principal',
    routerReady: true, inRegistrationFlow: false, requiresSession: true,
  };

  function harness(uid: string | null = 'a') {
    const route = new BehaviorSubject(protectedRoute);
    const uid$ = new BehaviorSubject(uid);
    const session = {
      uid$, ready$: new BehaviorSubject(true), isTerminating$: new BehaviorSubject(false),
      isTerminatingSnapshot: false, currentAuthUser: uid ? { uid } : null,
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: session },
        { provide: AuthRouteContextService, useValue: { context$: route } },
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
      ],
    });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const block = TestBed.inject(AuthAppBlockService);
    const errors = TestBed.inject(ApplicationErrorService);
    const exit = TestBed.inject(AuthSessionExitService);
    const states: unknown[] = [];
    exit.pending$.subscribe(reason => states.push(reason));
    const failures: boolean[] = [];
    exit.loginFailed$.subscribe((failed) => failures.push(failed));
    exit.start();
    const lastUrl = () => router.serializeUrl(navigate.mock.lastCall![0] as UrlTree);
    const change = (next: string | null) => {
      session.currentAuthUser = next ? { uid: next } : null;
      uid$.next(next);
    };
    return { route, session, navigate, block, errors, exit, states, failures, lastUrl, change };
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('oculta a tela ativa no UID → null e abre o login com o destino de retorno', () => {
    const t = harness();
    t.change(null);
    expect(t.states.at(-1)).toBe('session-ended');
    expect(t.lastUrl()).toBe('/login?reason=session-ended&redirectTo=%2Fdashboard%2Fprincipal');
    t.route.next({
      ...protectedRoute, navPath: '/login', currentUrl: t.lastUrl(), requiresSession: false,
      inRegistrationFlow: true,
    });
    expect(t.states.at(-1)).toBeNull();
    t.block.recordInvalidation('a', 'session-disabled', false);
    expect(t.lastUrl()).toBe('/login?reason=session-disabled&redirectTo=%2Fdashboard%2Fprincipal');
  });

  it('recebe motivo de outra aba somente no UID correspondente', () => {
    const t = harness('b');
    const receive = (uid: string) => {
      markAuthInvalidUid(uid, 'session-expired');
      window.dispatchEvent(new StorageEvent('storage', {
        key: authInvalidMarkerKey(uid), storageArea: localStorage, newValue: 'session-expired',
      }));
    };
    receive('a');
    expect(t.navigate).not.toHaveBeenCalled();
    receive('b');
    expect(t.lastUrl()).toContain('reason=session-expired');
    expect(t.states.at(-1)).toBe('session-expired');
  });

  it('preserva o fluxo do logout voluntário mesmo se null emitir primeiro', () => {
    const t = harness();
    t.session.isTerminatingSnapshot = true;
    t.change(null);
    t.session.isTerminating$.next(true);
    t.session.isTerminatingSnapshot = false;
    t.session.isTerminating$.next(false);
    expect(t.navigate).not.toHaveBeenCalled();
    expect(t.states).toEqual([null]);
  });

  it.each(['cancelled', 'rejected', 'pending'] as const)(
    'mantém a tela protegida oculta e permite abrir login de novo após navegação %s',
    async (failure) => {
      vi.useFakeTimers();
      const t = harness();
      if (failure === 'cancelled') t.navigate.mockResolvedValueOnce(false);
      if (failure === 'rejected') t.navigate.mockRejectedValueOnce(new Error('router failed'));
      if (failure === 'pending') t.navigate.mockReturnValueOnce(new Promise<boolean>(() => {}));

      t.session.isTerminatingSnapshot = true;
      t.session.isTerminating$.next(true);
      t.change(null);
      t.exit.markSignedOut();
      expect(t.states.at(-1)).toBe('signed-out');

      const firstAttempt = firstValueFrom(t.exit.openAfterLogout$());
      await vi.advanceTimersByTimeAsync(12_000);
      await firstAttempt;
      t.session.isTerminatingSnapshot = false;
      t.session.isTerminating$.next(false);
      expect(t.failures.at(-1)).toBe(true);
      expect(t.states.at(-1)).toBe('signed-out');
      expect(t.errors.report).toHaveBeenCalledOnce();

      t.exit.retryLogin();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.lastUrl()).toBe('/login?reason=signed-out');
      expect(t.navigate).toHaveBeenCalledTimes(2);
      expect(t.failures.at(-1)).toBe(false);
      expect(t.states.at(-1)).toBeNull();
    }
  );

  it('permite que uma sessão ausente em uma rota nova seja decidida pelo guard', () => {
    const t = harness(null);
    expect(t.navigate).not.toHaveBeenCalled();
  });
});
