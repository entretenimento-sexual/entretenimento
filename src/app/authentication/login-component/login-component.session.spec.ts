import { CommonModule } from '@angular/common';
import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterModule, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { User } from 'firebase/auth';
import { BehaviorSubject, NEVER, Observable, Subject, combineLatest, defer, filter, firstValueFrom, map, of, throwError } from 'rxjs';
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
import { RegisterNavigationService } from 'src/app/register-module/data-access/register-navigation.service';
import { RegisterFlowFacade } from 'src/app/register-module/data-access/register-flow.facade';
import type { RegisterFlowVm } from 'src/app/register-module/data-access/register-flow.model';
import { registrationStepGuard } from 'src/app/register-module/data-access/registration-step.guard';

import { LoginComponent } from './login-component';

@Component({ selector: 'app-session-test-destination', template: '' })
class DestinationComponent {}

describe('LoginComponent e sessão compartilhada', () => {
  const destination = '/conta?aba=seguranca#dados';
  const attempt = '/login?redirectTo=' + encodeURIComponent(destination);
  const registrationTarget = '/adulto/verificar-idade?redirectTo=%2Fconta%3Faba%3Dseguranca#declaracao';
  let harness: RouterTestingHarness;
  let router: Router;
  let uid$: BehaviorSubject<string | null>;
  let appUser$: BehaviorSubject<{ uid: string; profileCompleted: boolean } | undefined>;
  let blockedReason$: BehaviorSubject<string | null>;
  let login$: ReturnType<typeof vi.fn>;
  let googleLogin$: ReturnType<typeof vi.fn>;
  let resolveAfterEmailLogin$: ReturnType<typeof vi.fn>;
  let authUser: { uid: string } | null;
  let report: ReturnType<typeof vi.fn>;
  let registrationVm$: Observable<RegisterFlowVm>;
  let invalidation: AuthAppBlockService['invalidationSnapshot'];

  beforeEach(async () => {
    uid$ = new BehaviorSubject<string | null>(null);
    appUser$ = new BehaviorSubject<{ uid: string; profileCompleted: boolean } | undefined>(undefined);
    blockedReason$ = new BehaviorSubject<string | null>(null);
    login$ = vi.fn();
    googleLogin$ = vi.fn();
    resolveAfterEmailLogin$ = vi.fn();
    authUser = null;
    report = vi.fn().mockReturnValue({ userMessage: 'Falha na tentativa local.' });
    const navigation = new RegisterNavigationService();
    registrationVm$ = combineLatest([uid$, appUser$]).pipe(map(([uid, user]) =>
      navigation.resolveVm({
        uid, authReady: true, email: null, emailVerified: true, userExists: user?.uid === uid,
        userResolved: user?.uid === uid, termsAccepted: true, ageEligibilityAllowed: true,
        profileCompleted: user?.profileCompleted === true,
      })
    ));
    invalidation = null;
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
          {
            path: 'register/aceitar-termos',
            component: DestinationComponent,
            canMatch: [guestOnlyCanMatch],
            canActivate: [guestOnlyCanActivate, registrationStepGuard],
            data: { allowedRegisterSteps: ['termsAcceptance'] },
          },
        ], withComponentInputBinding()),
        { provide: AuthSessionService, useValue: {
          ready$, uid$,
          get currentAuthUser() {
            if (authUser?.uid !== uid$.value) authUser = uid$.value ? { uid: uid$.value } : null;
            return authUser;
          },
        } },
        { provide: AccessControlService, useValue: {
          ready$, authUid$: uid$, appUser$, blockedReason$, emailVerified$: of(true),
        } },
        { provide: AuthAppBlockService, useValue: {
          get invalidationSnapshot() { return invalidation; },
          reason$: blockedReason$,
        } },
        { provide: AuthReturnUrlService, useValue: {
          resolveAuthedRedirect: (redirect: string | null, fallback: string) => redirect ?? fallback,
        } },
        { provide: ApplicationErrorService, useValue: { report } },
        { provide: ErrorNotificationService, useValue: { showError: vi.fn() } },
        { provide: AuthFacade, useValue: { googleLogin$ } },
        { provide: EmailInputModalService, useValue: {} },
        { provide: LoginService, useValue: { login$ } },
        { provide: PostAuthNavigationService, deps: [RegisterFlowFacade, AuthSessionService],
          useFactory: (flow: RegisterFlowFacade, session: AuthSessionService) =>
            Object.assign(new PostAuthNavigationService(flow, session), { resolveAfterEmailLogin$ }),
        },
        { provide: RegisterFlowFacade, useValue: { vm$: defer(() => registrationVm$) } },
      ],
    }).overrideComponent(LoginComponent, { set: { styleUrls: [] } });

    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create(attempt);
  });

  function waitForDestination() {
    return firstValueFrom(router.events.pipe(
      filter((event) => event instanceof NavigationEnd && event.urlAfterRedirects === destination)
    ));
  }

  it('anuncia identidade confirmada antes do perfil e oferece retomar sem senha se a navegação falhar', async () => {
    const login = await harness.navigateByUrl(attempt, LoginComponent);
    const result$ = new Subject<{ success: boolean }>();
    const target$ = new Subject<string>();
    let confirm!: (user: User) => void;
    login$.mockImplementation((_email, _password, _remember, confirmIdentity) => {
      confirm = confirmIdentity;
      return result$;
    });
    resolveAfterEmailLogin$.mockReturnValue(target$);
    login.loginForm.patchValue({ email: 'pessoa@example.com', password: 'senha' });
    login.login();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('.loading-overlay')?.textContent)
      .toContain('Conferindo e-mail e senha');

    uid$.next('uid-alice');
    confirm(TestBed.inject(AuthSessionService).currentAuthUser!);
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('.loading-overlay')?.textContent)
      .toContain('Identidade confirmada. Conferindo seu acesso');
    result$.next({ success: true });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValueOnce(false);
    target$.next(destination);
    await vi.waitFor(() => expect(login.sharedSessionStatus).toBe('failed'));
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('Continuar com a sessão atual');
    expect(navigate).toHaveBeenCalledOnce();
    expect(login$.mock.calls).toHaveLength(1);
  });

  it('mostra um convite neutro sem sessão e abre os Termos quando a sessão é restaurada', async () => {
    const target = '/register/aceitar-termos';
    await harness.navigateByUrl(target, LoginComponent);

    const loginUrl = router.parseUrl(router.url);
    expect(loginUrl.queryParamMap.get('retomarCadastro')).toBe('1');
    expect(loginUrl.queryParamMap.has('reason')).toBe(false);
    expect(harness.routeNativeElement?.textContent).toContain('Entre com a mesma conta para continuar de onde parou.');
    expect(harness.routeNativeElement?.textContent).not.toContain('Sua sessão foi encerrada.');
    expect(harness.routeNativeElement?.querySelector('form')).not.toBeNull();

    registrationVm$ = of({
      authReady: true, uid: 'shared-user', email: null, emailVerified: true,
      userResolved: true, userExists: true, termsAccepted: false, ageEligibilityAllowed: false,
      profileCompleted: false, currentStep: 'termsAcceptance', nextRoute: target,
      progress: 60, canContinue: true, primaryActionLabel: 'Aceitar e continuar',
    });
    const navigated = firstValueFrom(router.events.pipe(
      filter((event) => event instanceof NavigationEnd && event.urlAfterRedirects === target)
    ));
    uid$.next('shared-user');
    appUser$.next({ uid: 'shared-user', profileCompleted: false });

    await navigated;
    expect(router.url).toBe(target);
    expect(login$).not.toHaveBeenCalled();
  });

  it('mantém somente o aviso de expiração quando o motivo está registrado', async () => {
    invalidation = { uid: 'expired-user', reason: 'session-expired' };
    await harness.navigateByUrl('/register/aceitar-termos', LoginComponent);
    expect(router.parseUrl(router.url).queryParamMap.get('reason')).toBe('session-expired');
    expect(harness.routeNativeElement?.textContent).toContain('Sua sessão expirou. Entre novamente para continuar.');
    expect(harness.routeNativeElement?.textContent).not.toContain('Use a mesma conta');
    expect(harness.routeNativeElement?.querySelector('form')).not.toBeNull();
  });

  it('segue para o destino original quando outra aba autentica e o perfil termina de carregar', async () => {
    expect(router.url).toBe(attempt);
    const navigated = waitForDestination();

    uid$.next('shared-user');
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('Sua sessão foi reconhecida. Abrindo sua conta');
    appUser$.next({ uid: 'shared-user', profileCompleted: true });

    await navigated;
    expect(router.url).toBe(destination);
    expect(login$).not.toHaveBeenCalled();
  });

  it.each(['senha', 'Google'] as const)(
    'retoma a sessão da outra aba ao terminar uma tentativa local por %s',
    async (provider) => {
      const page = harness.routeDebugElement!.componentInstance as LoginComponent;
      const request = new Subject<{ success: boolean; message: string }>();
      const navigate = vi.spyOn(router, 'navigateByUrl');
      if (provider === 'senha') {
        login$.mockReturnValue(request);
        page.loginForm.patchValue({ email: 'qa@example.test', password: 'qa-password' });
        page.login();
      } else {
        googleLogin$.mockReturnValue(request);
        page.loginWithGoogle();
      }
      expect(page.isLoading).toBe(true);

      uid$.next('shared-user');
      appUser$.next({ uid: 'shared-user', profileCompleted: true });
      expect(navigate).not.toHaveBeenCalled();

      const navigated = waitForDestination();
      if (provider === 'senha') {
        request.next({ success: false, message: 'Falha na tentativa local.' });
        request.complete();
      } else {
        request.error(new Error('Falha no Google.'));
      }

      await navigated;
      expect(router.url).toBe(destination);
      expect(navigate).toHaveBeenCalledOnce();
      expect(login$).toHaveBeenCalledTimes(provider === 'senha' ? 1 : 0);
      expect(googleLogin$).toHaveBeenCalledTimes(provider === 'Google' ? 1 : 0);
    }
  );

  it.each(['cancelada', 'rejeitada', 'sem resposta'] as const)(
    'oferece continuar com a sessão ativa quando a navegação é %s',
    async (outcome) => {
      vi.useFakeTimers();
      try {
        const navigate = vi.spyOn(router, 'navigateByUrl');
        if (outcome === 'cancelada') navigate.mockResolvedValueOnce(false);
        if (outcome === 'rejeitada') navigate.mockRejectedValueOnce(new Error('Rota indisponível'));
        if (outcome === 'sem resposta') navigate.mockReturnValueOnce(new Promise(() => {}));
        uid$.next('shared-user');
        appUser$.next({ uid: 'shared-user', profileCompleted: true });
        await vi.advanceTimersByTimeAsync(outcome === 'sem resposta' ? 15_000 : 0);
        harness.detectChanges();

        expect(harness.routeNativeElement?.textContent).toContain(
          'Sua sessão está ativa. Não conseguimos abrir a próxima tela.'
        );
        expect(harness.routeNativeElement?.querySelector('form')).toBeNull();
        expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
          operation: 'resumeSharedSession',
        }));
        const action = harness.routeNativeElement!.querySelector<HTMLButtonElement>('button')!;
        expect(action.textContent).toContain('Continuar com a sessão atual');
        const navigated = waitForDestination();
        action.click();
        action.click();
        await navigated;
        expect(router.url).toBe(destination);
        expect(navigate).toHaveBeenCalledTimes(2);
        expect(login$).not.toHaveBeenCalled();
        expect(googleLogin$).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('volta a oferecer o formulário se a sessão terminar durante a navegação', async () => {
    let finishNavigation!: (result: boolean) => void;
    vi.spyOn(router, 'navigateByUrl').mockReturnValueOnce(new Promise((resolve) => {
      finishNavigation = resolve;
    }));
    uid$.next('shared-user');
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('form')).toBeNull();

    uid$.next(null);
    finishNavigation(false);
    await Promise.resolve();
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('form')).not.toBeNull();
    expect(harness.routeNativeElement?.textContent).not.toContain('Continuar com a sessão atual');
    expect(report).not.toHaveBeenCalled();
  });

  it('reavalia o guard do destino mesmo se o carregamento do perfil já tiver expirado', async () => {
    vi.useFakeTimers();
    try {
      uid$.next('shared-user');
      await vi.advanceTimersByTimeAsync(8_000);
      harness.detectChanges();
      expect(router.parseUrl(router.url).queryParamMap.get('reason')).toBe('auth_unavailable');
      expect(harness.routeNativeElement?.textContent).toContain('Sua sessão está ativa. Não conseguimos consultar a próxima etapa');

      appUser$.next({ uid: 'shared-user', profileCompleted: true });
      const navigated = waitForDestination();
      harness.routeNativeElement?.querySelector<HTMLButtonElement>('button')?.click();
      await navigated;
      expect(router.url).toBe(destination);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mantém o login disponível quando a credencial recebida está bloqueada', () => {
    const navigate = vi.spyOn(router, 'navigateByUrl');
    blockedReason$.next('auth-invalid');
    uid$.next('blocked-user');

    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('form')).not.toBeNull();
    expect(router.url).toBe(attempt);
    expect(navigate).not.toHaveBeenCalled();
    expect(login$).not.toHaveBeenCalled();
  });

  async function openRegistrationWithSession(): Promise<void> {
    await harness.navigateByUrl('/conta');
    uid$.next('shared-user');
    appUser$.next({ uid: 'shared-user', profileCompleted: false });
    registrationVm$ = NEVER;
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
      const action = harness.routeNativeElement!.querySelector<HTMLButtonElement>('button')!;
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
