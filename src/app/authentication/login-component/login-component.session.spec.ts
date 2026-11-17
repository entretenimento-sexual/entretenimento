import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, filter, firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { guestOnlyCanActivate, guestOnlyCanMatch } from '@core/guards/auth-guard/guest-only.guard';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { AuthAppBlockService } from '@core/services/autentication/auth/auth-app-block.service';
import { AuthFacade } from '@core/services/autentication/auth/auth.facade';
import { AuthReturnUrlService } from '@core/services/autentication/auth/auth-return-url.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { EmailInputModalService } from '@core/services/autentication/email-input-modal.service';
import { LoginService } from '@core/services/autentication/login.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { PostAuthNavigationService } from 'src/app/register-module/data-access/post-auth-navigation.service';

import { LoginComponent } from './login-component';

@Component({ selector: 'app-session-test-destination', template: '' })
class DestinationComponent {}

describe('LoginComponent e sessão compartilhada', () => {
  const attempt = '/login?redirectTo=%2Fconta';
  let router: Router;
  let uid$: BehaviorSubject<string | null>;
  let appUser$: BehaviorSubject<{ uid: string; profileCompleted: boolean } | undefined>;
  let blockedReason$: BehaviorSubject<string | null>;
  let login$: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    uid$ = new BehaviorSubject<string | null>(null);
    appUser$ = new BehaviorSubject<{ uid: string; profileCompleted: boolean } | undefined>(undefined);
    blockedReason$ = new BehaviorSubject<string | null>(null);
    login$ = vi.fn();
    const ready$ = of(true);
    TestBed.configureTestingModule({
      declarations: [LoginComponent],
      providers: [
        FormBuilder,
        provideRouter([
          {
            path: 'login',
            component: LoginComponent,
            canMatch: [guestOnlyCanMatch],
            canActivate: [guestOnlyCanActivate],
          },
          { path: 'conta', component: DestinationComponent },
          { path: 'dashboard/principal', component: DestinationComponent },
        ]),
        { provide: AuthSessionService, useValue: {
          ready$, uid$,
          get currentAuthUser() { return uid$.value ? { uid: uid$.value } : null; },
        } },
        { provide: AccessControlService, useValue: {
          ready$, authUid$: uid$, appUser$, blockedReason$, emailVerified$: of(true),
        } },
        { provide: AuthAppBlockService, useValue: { invalidationSnapshot: null } },
        { provide: AuthReturnUrlService, useValue: {
          resolveAuthedRedirect: (redirect: string | null, fallback: string) => redirect ?? fallback,
        } },
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
        { provide: ErrorNotificationService, useValue: { showError: vi.fn() } },
        { provide: AuthFacade, useValue: {} },
        { provide: EmailInputModalService, useValue: {} },
        { provide: LoginService, useValue: { login$ } },
        { provide: PostAuthNavigationService, useValue: {} },
      ],
    }).overrideComponent(LoginComponent, { set: { template: '', styleUrls: [] } });

    router = TestBed.inject(Router);
    await RouterTestingHarness.create(attempt);
  });

  it('segue para o destino original quando outra aba autentica e o perfil termina de carregar', async () => {
    expect(router.url).toBe(attempt);
    const navigated = firstValueFrom(router.events.pipe(
      filter((event) => event instanceof NavigationEnd && event.urlAfterRedirects === '/conta')
    ));

    uid$.next('shared-user');
    appUser$.next({ uid: 'shared-user', profileCompleted: true });

    await navigated;
    expect(router.url).toBe('/conta');
    expect(login$).not.toHaveBeenCalled();
  });

  it('mantém o login disponível quando a credencial recebida está bloqueada', async () => {
    const finished = firstValueFrom(router.events.pipe(
      filter((event) => event instanceof NavigationEnd)
    ));

    blockedReason$.next('auth-invalid');
    uid$.next('blocked-user');

    await finished;
    expect(router.url).toBe(attempt);
    expect(login$).not.toHaveBeenCalled();
  });
});
