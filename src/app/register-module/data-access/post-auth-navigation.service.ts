import { Injectable } from '@angular/core';

import { Observable, of } from 'rxjs';
import {
  catchError,
  filter,
  map,
  take,
  timeout,
} from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import type { AuthFacadeSocialAuthResult } from 'src/app/core/services/autentication/auth/auth.facade';
import type { LoginResult } from 'src/app/core/services/autentication/login.service';
import { hasAcceptedCurrentTerms } from 'src/app/core/services/compliance/terms-acceptance.service';

import { RegisterFlowFacade } from './register-flow.facade';
import type { RegisterFlowVm } from './register-flow.model';

@Injectable({ providedIn: 'root' })
export class PostAuthNavigationService {
  private readonly flowTimeoutMs = 3500;

  constructor(private readonly registerFlow: RegisterFlowFacade) {}

  resolveAfterEmailLogin$(
    result: LoginResult,
    redirectTo: string
  ): Observable<string> {
    const safeRedirectTo = this.sanitizeRedirectTo(redirectTo);
    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);

    if (lifecycleRoute) {
      return of(lifecycleRoute);
    }

    if (result.emailVerified !== true) {
      return of(this.withRedirectTo('/register/welcome?autocheck=1', safeRedirectTo));
    }

    return this.resolveFromRegisterFlow$(
      result.user,
      safeRedirectTo,
      () => this.resolveEmailFallback(result, safeRedirectTo)
    );
  }

  resolveAfterSocialLogin$(
    result: AuthFacadeSocialAuthResult,
    redirectTo: string
  ): Observable<string> {
    const safeRedirectTo = this.sanitizeRedirectTo(redirectTo);
    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);

    if (lifecycleRoute) {
      return of(lifecycleRoute);
    }

    if (result.emailVerified !== true) {
      return of(this.withRedirectTo('/register/welcome?autocheck=1', safeRedirectTo));
    }

    return this.resolveFromRegisterFlow$(
      result.user,
      safeRedirectTo,
      () => this.resolveSocialFallback(result, safeRedirectTo)
    );
  }

  private resolveFromRegisterFlow$(
    user: IUserDados | null | undefined,
    redirectTo: string,
    fallback: () => string
  ): Observable<string> {
    return this.registerFlow.vm$.pipe(
      filter((vm) => vm.authReady === true && !!vm.uid),
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
    redirectTo: string,
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

      case 'profileCompletion':
        return this.profileCompletionRoute(vm.uid, redirectTo);

      case 'adultConsent':
        return this.withRedirectTo(
          vm.nextRoute || '/adulto/confirmar',
          redirectTo
        );

      case 'preferences':
        return redirectTo;

      case 'loading':
      case 'signup':
      default:
        return fallback();
    }
  }

  private resolveEmailFallback(
    result: LoginResult,
    redirectTo: string
  ): string {
    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);
    if (lifecycleRoute) {
      return lifecycleRoute;
    }

    if (result.emailVerified !== true) {
      return this.withRedirectTo('/register/welcome?autocheck=1', redirectTo);
    }

    if (result.profileResolution !== 'resolved') {
      return this.withRedirectTo('/register/welcome?autocheck=1', redirectTo);
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

    return redirectTo;
  }

  private resolveSocialFallback(
    result: AuthFacadeSocialAuthResult,
    redirectTo: string
  ): string {
    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);
    if (lifecycleRoute) {
      return lifecycleRoute;
    }

    if (result.emailVerified !== true) {
      return this.withRedirectTo('/register/welcome?autocheck=1', redirectTo);
    }

    if (!hasAcceptedCurrentTerms(result.user?.acceptedTerms)) {
      return this.withRedirectTo('/register/aceitar-termos', redirectTo);
    }

    if (
      result.nextRoute === '/register/finalizar-cadastro' ||
      result.user?.profileCompleted === false
    ) {
      return this.profileCompletionRoute(result.user?.uid ?? null, redirectTo);
    }

    if (result.nextRoute === '/conta/status') {
      return '/conta/status';
    }

    return redirectTo;
  }

  private profileCompletionRoute(
    uid: string | null | undefined,
    redirectTo: string
  ): string {
    const safeUid = String(uid ?? '').trim();
    const fallbackRedirect = safeUid
      ? `/preferencias/editar/${encodeURIComponent(safeUid)}`
      : '/dashboard/principal';
    const target = this.sanitizeRedirectTo(redirectTo || fallbackRedirect);

    return `/register/finalizar-cadastro?reason=profile_incomplete&redirectTo=${encodeURIComponent(target)}`;
  }

  private withRedirectTo(route: string, redirectTo: string): string {
    const safeRoute = String(route ?? '').trim() || '/register';
    const safeRedirectTo = this.sanitizeRedirectTo(redirectTo);

    if (/[?&]redirectTo=/.test(safeRoute)) {
      return safeRoute;
    }

    const separator = safeRoute.includes('?') ? '&' : '?';
    return `${safeRoute}${separator}redirectTo=${encodeURIComponent(safeRedirectTo)}`;
  }

  private sanitizeRedirectTo(raw: string | null | undefined): string {
    const value = String(raw ?? '').trim();

    if (!value || !value.startsWith('/') || value.startsWith('//')) {
      return '/dashboard/principal';
    }

    if (
      value === '/login' ||
      value.startsWith('/login?') ||
      value === '/register' ||
      value.startsWith('/register?') ||
      value.startsWith('/register/welcome') ||
      value.startsWith('/register/recuperar-conta') ||
      value.startsWith('/register/aceitar-termos') ||
      value.startsWith('/register/finalizar-cadastro') ||
      value.startsWith('/adulto/confirmar')
    ) {
      return '/dashboard/principal';
    }

    return value;
  }

  private resolveAccountLifecycleRoute(
    user: IUserDados | null | undefined
  ): string | null {
    const status = String(user?.accountStatus ?? '').trim().toLowerCase();

    if (status === 'deleted') {
      return '/conta/status?reason=deleted';
    }

    if (
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
