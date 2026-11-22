import { Injectable, Optional } from '@angular/core';
import { Store } from '@ngrx/store';
import { observeUserChanges } from 'src/app/store/actions/actions.user/user.actions';
import { Observable, catchError, defaultIfEmpty, defer, filter, map, merge, mergeMap, of, take, timeout, throwError } from 'rxjs';

import { AUTH_UNAVAILABLE_REASON } from '@core/guards/_shared-guard/guard-utils';
import { AuthReturnUrlService } from '@core/services/autentication/auth/auth-return-url.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import type { AuthFacadeSocialAuthResult } from '@core/services/autentication/auth/auth.facade';
import type { LoginResult } from '@core/services/autentication/login.service';

import { RegisterFlowFacade } from './register-flow.facade';
import {
  REGISTRATION_COMPLETION_ROUTE, isRegisterFlowDecisionReady, resolveRegistrationReturnUrl, type RegisterFlowVm,
} from './register-flow.model';

export const REGISTER_FLOW_WAIT_MS = 5_000;

@Injectable({ providedIn: 'root' })
export class PostAuthNavigationService {
  constructor(
    private readonly registerFlow: RegisterFlowFacade,
    private readonly authSession: AuthSessionService,
    @Optional() private readonly store?: Store,
    @Optional() private readonly returnUrl?: AuthReturnUrlService
  ) {}

  resolveAfterEmailLogin$(result: LoginResult, redirectTo: string | null): Observable<string> {
    return this.resolveForCurrentSession$(result.user?.uid, redirectTo);
  }

  resolveAfterSocialLogin$(result: AuthFacadeSocialAuthResult, redirectTo: string | null): Observable<string> {
    return this.resolveForCurrentSession$(result.user?.uid, redirectTo);
  }

  resolveForCurrentSession$(uid: string | undefined, redirectTo: string | null): Observable<string> {
    const safeRedirect = resolveRegistrationReturnUrl(redirectTo);
    const unavailable = this.withRedirectTo('/login?reason=' + AUTH_UNAVAILABLE_REASON + '&retomarCadastro=1', safeRedirect);

    return defer(() => {
      const user = this.authSession.currentAuthUser;
      const termination = this.authSession.terminationVersionSnapshot;
      const isCurrent = () => !!uid && user?.uid === uid &&
        this.authSession.currentAuthUser === user &&
        !this.authSession.isTerminatingSnapshot && this.authSession.terminationVersionSnapshot === termination;
      const changed = () => Object.assign(new Error('A conta ativa mudou durante a consulta do cadastro.'), {
        code: 'auth/session-changed',
      });

      if (!isCurrent()) return throwError(changed);

      const decision$ = this.registerFlow.vm$.pipe(
        filter((vm) => vm.uid === uid && isRegisterFlowDecisionReady(vm)),
        map((vm) => this.resolveReadyRoute(vm, safeRedirect)),
        timeout({ first: REGISTER_FLOW_WAIT_MS, with: () => of(unavailable) }),
        catchError(() => of(unavailable)),
        defaultIfEmpty(unavailable)
      );
      return merge(
        this.authSession.uid$.pipe(filter(() => !isCurrent()), mergeMap(() => throwError(changed))),
        decision$
      ).pipe(
        take(1),
        map((target) => {
          if (!isCurrent()) throw changed();
          return target;
        })
      );
    });
  }

  retryProfileLookup(): void {
    const uid = this.authSession.currentAuthUser?.uid;
    if (uid && !this.authSession.isTerminatingSnapshot) {
      this.store?.dispatch(observeUserChanges({ uid }));
    }
  }

  private resolveReadyRoute(vm: RegisterFlowVm, redirectTo: string | null): string {
    switch (vm.currentStep) {
      case 'accountStatus':
        return vm.nextRoute;
      case 'emailVerification':
        return this.withRedirectTo('/register/welcome?autocheck=1', redirectTo);
      case 'profileCompletion':
        return this.withRedirectTo(vm.nextRoute + '?reason=profile_incomplete', redirectTo ?? REGISTRATION_COMPLETION_ROUTE);
      case 'preferences':
        return this.returnUrl?.resolveAuthedRedirect(redirectTo, '/dashboard/principal') ??
          redirectTo ?? '/dashboard/principal';
      default:
        return this.withRedirectTo(vm.nextRoute, redirectTo);
    }
  }

  private withRedirectTo(route: string, redirectTo: string | null): string {
    if (!redirectTo) return route;

    const separator = route.includes('?') ? '&' : '?';
    return `${route}${separator}redirectTo=${encodeURIComponent(redirectTo)}`;
  }
}
