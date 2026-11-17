import { CommonModule } from '@angular/common';
import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterModule, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, NEVER, Observable, Subject, defer, filter, firstValueFrom, of, throwError } from 'rxjs';
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
import { RegisterFlowFacade } from 'src/app/register-module/data-access/register-flow.facade';
import type { RegisterFlowVm } from 'src/app/register-module/data-access/register-flow.model';
import { registrationStepGuard } from 'src/app/register-module/data-access/registration-step.guard';

import { LoginComponent } from './login-component';

@Component({ selector: 'app-session-test-destination', template: '' })
class DestinationComponent {}

describe('LoginComponent e sessão compartilhada', () => {
  const attempt = '/login?redirectTo=%2Fconta';
  const registrationTarget = '/adulto/verificar-idade?redirectTo=%2Fconta%3Faba%3Dseguranca#declaracao';
  let harness: RouterTestingHarness;
  let router: Router;
  let uid$: BehaviorSubject<string | null>;
  let appUser$: BehaviorSubject<{ uid: string; profileCompleted: boolean } | undefined>;
  let blockedReason$: BehaviorSubject<string | null>;
  let login$: ReturnType<typeof vi.fn>;
  let registrationVm$: Observable<RegisterFlowVm>;

  beforeEach(async () => {
    uid$ = new BehaviorSubject<string | null>(null);
    appUser$ = new BehaviorSubject<{ uid: string; profileCompleted: boolean } | undefined>(undefined);
    blockedReason$ = new BehaviorSubject<string | null>(null);
    login$ = vi.fn();
    registrationVm$ = NEVER;
    const ready$ = of(true);
    TestBed.configureTestingModule({
      declarations: [LoginComponent],
      imports: [CommonModule, ReactiveFormsModule, RouterModule],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideRouter([
          {
            path: 'login',
            component: LoginComponent,
            canMatch: [guestOnlyCanMatch],
            canActivate: [guestOnlyCanActivate],
          },
          { path: 'conta', component: DestinationComponent },
          { path: 'dashboard/principal', component: DestinationComponent },
          {
            path: 'adulto/verificar-idade',
            component: DestinationComponent,
            canActivate: [registrationStepGuard],
            data: { allowedRegisterSteps: ['ageVerification'] },
          },
          {
            path: 'register/finalizar-cadastro',
            component: DestinationComponent,
            canActivate: [registrationStepGuard],
            data: { allowedRegisterSteps: ['profileCompletion'] },
          },
        ], withComponentInputBinding()),
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
        { provide: RegisterFlowFacade, useValue: { vm$: defer(() => registrationVm$) } },
      ],
    }).overrideComponent(LoginComponent, { set: { styleUrls: [] } });

    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create(attempt);
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

  async function openRegistrationWithSession(): Promise<void> {
    await harness.navigateByUrl('/conta');
    uid$.next('shared-user');
    appUser$.next({ uid: 'shared-user', profileCompleted: false });
  }

  it('interrompe o ciclo no timeout e retoma a etapa na mesma sessão com o destino original', async () => {
    await openRegistrationWithSession();
    vi.useFakeTimers();
    try {
      const pending = harness.navigateByUrl(registrationTarget, LoginComponent);
      await vi.advanceTimersByTimeAsync(5000);
      await pending;
      const recoveryUrl = router.parseUrl(router.url);
      expect(recoveryUrl.queryParamMap.get('reason')).toBe('auth_unavailable');
      expect(recoveryUrl.queryParamMap.get('redirectTo')).toBe(registrationTarget);
      expect(harness.routeNativeElement?.textContent).toContain('Sua sessão está ativa.');
      expect(harness.routeNativeElement?.querySelector('form')).toBeNull();

      const ready = new Subject<RegisterFlowVm>();
      registrationVm$ = ready;
      const navigated = firstValueFrom(router.events.pipe(
        filter((event) => event instanceof NavigationEnd && event.urlAfterRedirects === registrationTarget)
      ));
      const action = harness.routeNativeElement?.querySelector<HTMLButtonElement>('button')!;
      expect(action.textContent).toContain('Tentar novamente');
      action.click();
      harness.detectChanges();
      expect(action.disabled).toBe(true);
      expect(harness.routeNativeElement?.textContent).toContain('Consultando a próxima etapa');
      await vi.advanceTimersByTimeAsync(0);
      ready.next({
        authReady: true,
        uid: 'shared-user',
        email: null,
        emailVerified: true,
        userResolved: true,
        userExists: true,
        termsAccepted: true,
        ageEligibilityAllowed: false,
        profileCompleted: false,
        currentStep: 'ageVerification',
        nextRoute: '/adulto/verificar-idade',
        progress: 50,
        canContinue: true,
        primaryActionLabel: 'Confirmar 18+',
      });

      await navigated;
      expect(router.url).toBe(registrationTarget);
      expect(uid$.value).toBe('shared-user');
      expect(login$).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('exibe a recuperação em caso de erro e oferece login se a sessão terminar', async () => {
    await openRegistrationWithSession();
    registrationVm$ = throwError(() => new Error('Consulta indisponível'));

    await harness.navigateByUrl(registrationTarget, LoginComponent);
    expect(harness.routeNativeElement?.textContent).toContain('Retomar cadastro');

    uid$.next(null);
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('form')).not.toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain('Não foi possível confirmar seu acesso');
    expect(login$).not.toHaveBeenCalled();
  });
});
