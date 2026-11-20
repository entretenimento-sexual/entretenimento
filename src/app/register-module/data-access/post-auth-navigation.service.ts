import { Injectable } from '@angular/core';

import { Observable, defer, of } from 'rxjs';
import {
  catchError,
  filter,
  map,
  take,
  timeout,
} from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import type { AuthFacadeSocialAuthResult } from 'src/app/core/services/autentication/auth/auth.facade';
import type { LoginResult } from 'src/app/core/services/autentication/login.service';
import { hasAcceptedCurrentTerms } from 'src/app/core/services/compliance/terms-acceptance.service';

import { normalizeUserAccountLifecycleStatus } from '@core/services/autentication/auth/account-lifecycle.policy';
import { RegisterFlowFacade } from './register-flow.facade';
import { REGISTRATION_COMPLETION_ROUTE, resolveRegistrationReturnUrl, type RegisterFlowVm } from './register-flow.model';

@Injectable({ providedIn: 'root' })
export class PostAuthNavigationService {
  private readonly flowTimeoutMs = 3500;

  constructor(
    private readonly registerFlow: RegisterFlowFacade,
    private readonly authSession: AuthSessionService
  ) {}

  resolveAfterEmailLogin$(
    result: LoginResult,
    redirectTo: string | null
  ): Observable<string> {
    return this.resolveForCurrentSession$(result.user?.uid, () =>
      this.resolveEmailDestination$(result, redirectTo)
    );
  }

  private resolveEmailDestination$(
    result: LoginResult,
    redirectTo: string | null
  ): Observable<string> {
    const safeRedirectTo = resolveRegistrationReturnUrl(redirectTo);
    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);

    if (lifecycleRoute) {
      return of(lifecycleRoute);
    }

    if (result.emailVerified !== true) {
      return of(this.withRedirectTo('/register/welcome?autocheck=1', safeRedirectTo));
    }

    /**
     * O Firebase Auth já concluiu, mas users/{uid} não foi resolvido por falha ou
     * timeout. A etapa idempotente confirma o documento existente ou reconstrói
     * apenas o seed ausente, sem tratar isso como nova falha de autenticação.
     */
    if (result.profileResolution !== 'resolved') {
      return of(
        this.withRedirectTo('/register/recuperar-conta', safeRedirectTo)
      );
    }

    return this.resolveFromRegisterFlow$(
      result.user,
      safeRedirectTo,
      () => this.resolveEmailFallback(result, safeRedirectTo)
    );
  }

  resolveAfterSocialLogin$(
    result: AuthFacadeSocialAuthResult,
    redirectTo: string | null
  ): Observable<string> {
    return this.resolveForCurrentSession$(result.user?.uid, () =>
      this.resolveSocialDestination$(result, redirectTo)
    );
  }

  private resolveSocialDestination$(
    result: AuthFacadeSocialAuthResult,
    redirectTo: string | null
  ): Observable<string> {
    const safeRedirectTo = resolveRegistrationReturnUrl(redirectTo);
    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);

    if (lifecycleRoute) {
      return of(lifecycleRoute);
    }

    if (result.emailVerified !== true) {
      return of(this.withRedirectTo('/register/welcome?autocheck=1', safeRedirectTo));
    }

    /**
     * O Firebase Auth já concluiu, mas a camada de perfil precisa confirmar ou
     * reconstruir users/{uid}. Não aguardamos o timeout do store para abrir a
     * etapa idempotente de recuperação.
     */
    if (result.nextRoute === '/register/recuperar-conta') {
      return of(
        this.withRedirectTo('/register/recuperar-conta', safeRedirectTo)
      );
    }

    return this.resolveFromRegisterFlow$(
      result.user,
      safeRedirectTo,
      () => this.resolveSocialFallback(result, safeRedirectTo)
    );
  }

  private resolveForCurrentSession$(
    expectedUid: string | undefined,
    destination: () => Observable<string>
  ): Observable<string> {
    const assertCurrentSession = () => {
      if (!expectedUid ||
        this.authSession.currentAuthUser?.uid !== expectedUid ||
        this.authSession.isTerminatingSnapshot
      ) {
        throw Object.assign(new Error('A sessão mudou durante o login.'), {
          code: 'auth/session-changed',
        });
      }
    };

    return defer(() => {
      assertCurrentSession();
      return destination().pipe(map((target) => {
        assertCurrentSession();
        return target;
      }));
    });
  }

  private resolveFromRegisterFlow$(
    user: IUserDados | null | undefined,
    redirectTo: string | null,
    fallback: () => string
  ): Observable<string> {
    return this.registerFlow.vm$.pipe(
      filter((vm) => vm.authReady === true && !!vm.uid && vm.uid === user?.uid),
      filter(
        (vm) =>
          vm.currentStep === 'emailVerification' ||
          vm.userResolved === true
      ),
      take(1),
      timeout({
        first: this.flowTimeoutMs,
        with: () => of(null as RegisterFlowVm | null),
      }),
      map((vm) => this.resolveVmRoute(vm, user, redirectTo, fallback)),
      catchError(() => of(fallback()))
    );
  }

  private resolveVmRoute(
    vm: RegisterFlowVm | null,
    user: IUserDados | null | undefined,
    redirectTo: string | null,
    fallback: () => string
  ): string {
    if (!vm) {
      return fallback();
    }

    const lifecycleRoute = this.resolveAccountLifecycleRoute(user);
    if (lifecycleRoute) {
      return lifecycleRoute;
    }

    switch (vm.currentStep) {
      case 'emailVerification':
        return this.withRedirectTo('/register/welcome?autocheck=1', redirectTo);

      case 'accountRecovery':
        return this.withRedirectTo(
          vm.nextRoute || '/register/recuperar-conta',
          redirectTo
        );

      case 'termsAcceptance':
        return this.withRedirectTo(
          vm.nextRoute || '/register/aceitar-termos',
          redirectTo
        );

      case 'ageVerification':
        return this.withRedirectTo(vm.nextRoute || '/adulto/verificar-idade', redirectTo);

      case 'profileCompletion':
        return this.profileCompletionRoute(redirectTo);

      case 'preferences':
        return redirectTo ?? '/dashboard/principal';

      case 'loading':
      case 'signup':
      default:
        return fallback();
    }
  }

  private resolveEmailFallback(
    result: LoginResult,
    redirectTo: string | null
  ): string {
    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);
    if (lifecycleRoute) {
      return lifecycleRoute;
    }

    if (result.emailVerified !== true) {
      return this.withRedirectTo('/register/welcome?autocheck=1', redirectTo);
    }

    if (result.profileResolution !== 'resolved') {
      return this.withRedirectTo('/register/recuperar-conta', redirectTo);
    }

    if (!hasAcceptedCurrentTerms(result.user?.acceptedTerms)) {
      return this.withRedirectTo('/register/aceitar-termos', redirectTo);
    }

    if (
      result.needsProfileCompletion === true ||
      result.user?.profileCompleted === false
    ) {
      // Fallback conservador: a etapa idempotente distingue documento ausente
      // de perfil apenas incompleto antes de prosseguir.
      return this.withRedirectTo('/register/recuperar-conta', redirectTo);
    }

    return redirectTo ?? '/dashboard/principal';
  }

  private resolveSocialFallback(
    result: AuthFacadeSocialAuthResult,
    redirectTo: string | null
  ): string {
    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);
    if (lifecycleRoute) {
      return lifecycleRoute;
    }

    if (result.emailVerified !== true) {
      return this.withRedirectTo('/register/welcome?autocheck=1', redirectTo);
    }

    if (result.nextRoute === '/register/recuperar-conta') {
      return this.withRedirectTo('/register/recuperar-conta', redirectTo);
    }

    if (!hasAcceptedCurrentTerms(result.user?.acceptedTerms)) {
      return this.withRedirectTo('/register/aceitar-termos', redirectTo);
    }

    if (
      result.nextRoute === '/register/finalizar-cadastro' ||
      result.user?.profileCompleted === false
    ) {
      return this.profileCompletionRoute(redirectTo);
    }

    if (result.nextRoute === '/conta/status') {
      return '/conta/status';
    }

    return redirectTo ?? '/dashboard/principal';
  }

  private profileCompletionRoute(redirectTo: string | null): string {
    return this.withRedirectTo('/register/finalizar-cadastro?reason=profile_incomplete',
      redirectTo ?? REGISTRATION_COMPLETION_ROUTE);
  }

  private withRedirectTo(route: string, redirectTo: string | null): string {
    if (!redirectTo || /[?&]redirectTo=/.test(route)) return route;

    const separator = route.includes('?') ? '&' : '?';
    return `${route}${separator}redirectTo=${encodeURIComponent(redirectTo)}`;
  }

  private resolveAccountLifecycleRoute(
    user: IUserDados | null | undefined
  ): string | null {
    const status = String(user?.accountStatus ?? '').trim().toLowerCase();

    if (status === 'deleted') {
      return '/conta/status?reason=deleted';
    }

    const runtimeStatus = normalizeUserAccountLifecycleStatus(user);
    if (
      runtimeStatus === 'locked' ||
      status === 'self_suspended' ||
      status === 'moderation_suspended' ||
      status === 'pending_deletion' ||
      status === 'suspended' ||
      status === 'locked' ||
      user?.suspended === true ||
      user?.accountLocked === true
    ) {
      return '/conta/status';
    }

    return null;
  }
}
