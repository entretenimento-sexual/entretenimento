import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router, provideRouter, type UrlTree } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, filter, firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authInvalidMarkerKey, markAuthInvalidUid } from '@core/firebase/auth-invalid-session-marker';
import { authGuard } from '@core/guards/auth-guard/auth.guard';
import { guestOnlyCanMatch } from '@core/guards/auth-guard/guest-only.guard';
import { unsavedChangesGuard } from '@core/guards/unsaved-changes/unsaved-changes.guard';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
import { AccessControlService } from './access-control.service';
import { AuthAppBlockService } from './auth-app-block.service';
import { AuthReturnUrlService } from './auth-return-url.service';
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
        { provide: MatDialog, useValue: { closeAll: vi.fn() } },
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

@Component({ selector: 'app-session-exit-draft-test', template: '{{ owner }}' })
class DraftPage {
  readonly owner = inject(AuthSessionService).currentAuthUser?.uid;
  hasUnsavedChanges = () => true;
  persistUnsavedChanges = vi.fn();
  discardUnsavedChanges = vi.fn();
  destroyed = false;

  ngOnDestroy(): void {
    this.destroyed = true;
  }
}

@Component({ selector: 'app-session-exit-login-test', template: '' })
class LoginPage {}

describe('AuthSessionExitService com o Router', () => {
  const home = '/dashboard/principal';

  async function setup() {
    const uid$ = new BehaviorSubject<string | null>('a');
    const appUser$ = new BehaviorSubject({ uid: 'a', profileCompleted: true });
    const ready$ = of(true);
    const isTerminating$ = of(false);
    const mayEnterHome = vi.fn(() => true);
    const dialog = { closeAll: vi.fn(), open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'dashboard/principal', component: DraftPage,
            canActivate: [authGuard, mayEnterHome], canDeactivate: [unsavedChangesGuard],
          },
          { path: 'login', component: LoginPage, canMatch: [guestOnlyCanMatch] },
        ]),
        { provide: AuthSessionService, useValue: {
          uid$, ready$, isTerminating$, isTerminatingSnapshot: false,
          get currentAuthUser() { return uid$.value ? { uid: uid$.value, emailVerified: true } : null; },
        } },
        { provide: AccessControlService, useValue: {
          ready$, appUser$, blockedReason$: of(null), emailVerified$: of(true),
        } },
        { provide: AuthReturnUrlService, useValue: {
          resolveAuthedRedirect: (redirect: string | null, fallback: string) => redirect ?? fallback,
        } },
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
        { provide: ErrorNotificationService, useValue: { showError: vi.fn() } },
        { provide: PrivacyDebugLoggerService, useValue: { log: vi.fn() } },
        { provide: MatDialog, useValue: dialog },
      ],
    });
    const router = TestBed.inject(Router);
    const exit = TestBed.inject(AuthSessionExitService);
    const states: unknown[] = [];
    exit.pending$.subscribe((reason) => states.push(reason));
    const failed: boolean[] = [];
    exit.loginFailed$.subscribe((failure) => failed.push(failure));
    exit.start();
    const harness = await RouterTestingHarness.create();
    const first = await harness.navigateByUrl(home, DraftPage);
    const nextNavigation = (path: string) => firstValueFrom(router.events.pipe(
      filter((event) => event instanceof NavigationEnd && event.urlAfterRedirects === path)
    ));
    return { router, exit, harness, first, dialog, states, failed, uid$, appUser$, mayEnterHome, nextNavigation };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('conserva o rascunho de A e recria o mesmo destino só depois de resolver B', async () => {
    const t = await setup();
    const neutral = t.nextNavigation('/login?reason=auth_unavailable');
    t.uid$.next('b');
    expect(t.states.at(-1)).toBe('account-switch');
    await neutral;
    expect(t.first.persistUnsavedChanges).toHaveBeenCalledOnce();
    expect(t.first.discardUnsavedChanges).not.toHaveBeenCalled();
    expect(t.first.destroyed).toBe(true);
    expect(t.dialog.closeAll).toHaveBeenCalledOnce();
    expect(t.dialog.open).not.toHaveBeenCalled();
    expect(t.states.at(-1)).toBe('account-switch');

    const homeOpen = t.nextNavigation(home);
    t.appUser$.next({ uid: 'b', profileCompleted: true });
    await homeOpen;
    await vi.waitFor(() => expect(t.states.at(-1)).toBeNull());
    t.harness.detectChanges();
    const current = t.harness.routeDebugElement!.componentInstance as DraftPage;
    expect(current).not.toBe(t.first);
    expect(current.owner).toBe('b');
  });

  it('mantém a transição protegida se a navegação falhar e recupera no retry', async () => {
    const t = await setup();
    t.mayEnterHome.mockReturnValue(false);
    t.uid$.next('b');
    t.appUser$.next({ uid: 'b', profileCompleted: true });
    await vi.waitFor(() => expect(t.failed.at(-1)).toBe(true));
    expect(t.states.at(-1)).toBe('account-switch');
    expect(t.first.persistUnsavedChanges).toHaveBeenCalledOnce();
    t.mayEnterHome.mockReturnValue(true);
    const homeOpen = t.nextNavigation(home);
    t.exit.retryLogin();
    await homeOpen;
    await vi.waitFor(() => expect(t.states.at(-1)).toBeNull());
    expect(t.failed.at(-1)).toBe(false);
    expect(t.first.persistUnsavedChanges).toHaveBeenCalledOnce();
  });

  it('só retira a proteção para C se B for substituído durante a transição', async () => {
    const t = await setup();
    const neutral = t.nextNavigation('/login?reason=auth_unavailable');
    t.uid$.next('b');
    await neutral;
    const homeOpen = t.nextNavigation(home);
    t.uid$.next('c');
    t.appUser$.next({ uid: 'b', profileCompleted: true });
    expect(t.states.at(-1)).toBe('account-switch');
    t.appUser$.next({ uid: 'c', profileCompleted: true });
    await homeOpen;
    await vi.waitFor(() => expect(t.states.at(-1)).toBeNull());
    t.harness.detectChanges();
    expect(t.harness.routeDebugElement!.componentInstance.owner).toBe('c');
    expect(t.first.persistUnsavedChanges).toHaveBeenCalledOnce();
  });
});
