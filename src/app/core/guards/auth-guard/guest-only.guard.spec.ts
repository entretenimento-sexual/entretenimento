import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject, ReplaySubject, of, startWith } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessControlService } from '../../services/autentication/auth/access-control.service';
import { AuthReturnUrlService } from '../../services/autentication/auth/auth-return-url.service';
import { AuthSessionService } from '../../services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from '../../services/error-handler/application-error.service';
import { ErrorNotificationService } from '../../services/error-handler/error-notification.service';
import { AUTH_GUARD_WAIT_MS } from '../_shared-guard/guard-utils';
import { guestOnlyCanActivate, guestOnlyCanMatch } from './guest-only.guard';

@Component({ template: '' })
class RouteFixtureComponent {}

describe('guestOnlyGuard e recuperação de navegação', () => {
  let router: Router;
  let ready$: BehaviorSubject<boolean>;
  let emailVerified$: BehaviorSubject<boolean>;
  let uid$: ReplaySubject<string | null>;
  let currentAuthUser: { uid: string; emailVerified: boolean };
  let appUser$: BehaviorSubject<{ uid: string; profileCompleted: boolean } | undefined>;

  beforeEach(() => {
    ready$ = new BehaviorSubject(true);
    emailVerified$ = new BehaviorSubject(true);
    uid$ = new ReplaySubject<string | null>(1);
    currentAuthUser = { uid: 'user-a', emailVerified: true };
    appUser$ = new BehaviorSubject<{ uid: string; profileCompleted: boolean } | undefined>(undefined);
    const guarded = {
      component: RouteFixtureComponent,
      canMatch: [guestOnlyCanMatch],
      canActivate: [guestOnlyCanActivate],
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'register', ...guarded, children: [{ path: 'welcome', component: RouteFixtureComponent }] },
          { path: 'login', ...guarded },
          { path: 'conta', component: RouteFixtureComponent },
          { path: 'painel', component: RouteFixtureComponent },
        ]),
        { provide: AccessControlService, useValue: {
          ready$, appUser$, authUid$: uid$.pipe(startWith(null)), blockedReason$: of(null), emailVerified$,
        } },
        { provide: AuthSessionService, useValue: { currentAuthUser, uid$ } },
        { provide: AuthReturnUrlService, useValue: {
          resolveAuthedRedirect: (redirect: string | null) => redirect ?? '/conta',
        } },
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
        { provide: ErrorNotificationService, useValue: { showError: vi.fn() } },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('abre o login de recuperação por ambos os guards sem esperar pelo SDK', async () => {
    ready$.next(false);
    const target = '/login?reason=auth_unavailable&redirectTo=%2Fconta';
    expect(await router.navigateByUrl(target)).toBe(true);
    expect(router.url).toBe(target);
  });

  it('redireciona uma consulta de perfil pendente e preserva o destino com os parâmetros', async () => {
    vi.useFakeTimers();
    uid$.next('user-a');
    appUser$.next({ uid: 'previous-user', profileCompleted: true });
    const target = '/register?redirectTo=%2Fconta';
    const navigation = router.navigateByUrl(target);

    await vi.advanceTimersByTimeAsync(AUTH_GUARD_WAIT_MS);
    expect(await navigation).toBe(true);
    expect(router.parseUrl(router.url).queryParams).toEqual({
      reason: 'auth_unavailable',
      redirectTo: target,
    });
    expect(router.url).toMatch(/^\/login\?/);
  });

  it('abre a verificação de e-mail da sessão atual enquanto o perfil privado ainda carrega', async () => {
    uid$.next('user-a');
    currentAuthUser.emailVerified = false;
    emailVerified$.next(false);
    expect(await router.navigateByUrl('/register/welcome?verificationEmail=failed')).toBe(true);
    expect(router.url).toMatch(/^\/register\/welcome\?/);
  });

  it('preserva a navegação normal quando o perfil da conta é resolvido a tempo', async () => {
    vi.useFakeTimers();
    uid$.next('user-a');
    const navigation = router.navigateByUrl('/login?redirectTo=%2Fpainel');
    await vi.advanceTimersByTimeAsync(0);
    appUser$.next({ uid: 'user-a', profileCompleted: true });
    expect(await navigation).toBe(true);
    expect(router.url).toBe('/painel');
  });

  it('aguarda a primeira identidade do Firebase ao abrir o login em nova aba', async () => {
    vi.useFakeTimers();
    const navigation = router.navigateByUrl('/login?redirectTo=%2Fpainel');
    await vi.advanceTimersByTimeAsync(0);
    expect(router.url).toBe('/');

    appUser$.next({ uid: 'user-a', profileCompleted: true });
    uid$.next('user-a');

    expect(await navigation).toBe(true);
    expect(router.url).toBe('/painel');
  });
});
