import { DestroyRef, Injectable, Injector, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { Router, type UrlTree } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  defer,
  firstValueFrom,
  from,
  fromEvent,
  of,
  timeout,
} from 'rxjs';

import { authInvalidMarkerKey, readAuthInvalidUid } from '@core/firebase/auth-invalid-session-marker';
import { AUTH_UNAVAILABLE_REASON } from '@core/guards/_shared-guard/guard-utils';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { AuthAppBlockService } from './auth-app-block.service';
import { AuthRouteContextService } from './auth-route-context.service';
import { AuthSessionService } from './auth-session.service';
import { PostAuthNavigationService } from 'src/app/register-module/data-access/post-auth-navigation.service';
import type { SessionEndReason } from './auth.types';

export const VOLUNTARY_LOGOUT_NOTICE = 'signed-out';
export const ACCOUNT_SWITCH_NOTICE = 'account-switch';
type LoginExitReason = SessionEndReason | typeof VOLUNTARY_LOGOUT_NOTICE;
type SessionExitNotice = LoginExitReason | typeof ACCOUNT_SWITCH_NOTICE;
const LOGIN_NAVIGATION_TIMEOUT_MS = 12_000;
const ACCOUNT_SWITCH_DEACTIVATION = Symbol('account-switch-deactivation');
const CURRENT_ACCOUNT_HOME = '/dashboard/principal';

@Injectable({ providedIn: 'root' })
export class AuthSessionExitService {
  private readonly session = inject(AuthSessionService);
  private readonly appBlock = inject(AuthAppBlockService);
  private readonly routes = inject(AuthRouteContextService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly errors = inject(ApplicationErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly pending = new BehaviorSubject<SessionExitNotice | null>(null);
  readonly pending$ = this.pending.asObservable();
  private readonly loginFailed = new BehaviorSubject(false);
  readonly loginFailed$ = this.loginFailed.asObservable();

  private started = false;
  private previousUid: string | null = null;
  private lostUid: string | null = null;
  private destination: UrlTree | null = null;
  private request: { target: string; done: Promise<void> } | null = null;
  private accountSwitch: { uid: string | null } | null = null;

  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;

    fromEvent<StorageEvent>(window, 'storage').pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        const active = this.session.currentAuthUser?.uid ?? null;
        const uid = active ?? this.lostUid;
        if (!uid || event.key !== authInvalidMarkerKey(uid)) return;

        const reason = readAuthInvalidUid(uid);
        if (reason) this.appBlock.applyInvalidation(uid, reason, active === uid);
        else if (active === uid && this.appBlock.invalidationSnapshot?.uid === uid) {
          this.appBlock.resolveInvalidation(uid);
        }
      });

    combineLatest([
      this.session.ready$,
      this.session.uid$,
      this.session.isTerminating$,
      this.routes.context$,
      this.appBlock.reason$,
      this.appBlock.invalidation$,
    ]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      ([ready, uid, terminating, route, blocked, invalidation]) => {
        if (!ready) return;
        terminating = terminating || this.session.isTerminatingSnapshot;
        const currentUid = this.session.currentAuthUser?.uid ?? null;
        const outgoingUid = this.previousUid ?? this.lostUid;
        const switchOnProtectedRoute = route.requiresSession && !terminating && !!currentUid &&
          ((outgoingUid !== null && outgoingUid !== currentUid) ||
            this.pending.value === VOLUNTARY_LOGOUT_NOTICE);

        // O UID operacional fica mascarado durante o logout. A identidade
        // anterior ainda é necessária para isolar a tela se outra conta entrar.
        if (!terminating && uid === currentUid) {
          if (uid) {
            this.previousUid = uid;
            this.lostUid = null;
          } else if (this.previousUid) {
            this.lostUid = this.previousUid;
            this.previousUid = null;
          }
        }

        if (this.pending.value === ACCOUNT_SWITCH_NOTICE || switchOnProtectedRoute) {
          if (terminating) {
            this.accountSwitch = null;
          } else if (this.accountSwitch?.uid !== currentUid) {
            this.openCurrentAccount(currentUid);
          }
          return;
        }

        const technical = blocked === 'auth-invalid' &&
          uid !== null && uid === invalidation?.uid && this.session.currentAuthUser?.uid === uid;
        const ended = uid === null && this.lostUid !== null && !terminating &&
          !this.session.currentAuthUser;
        const reason = technical || ended
          ? (invalidation && invalidation.uid === (uid ?? this.lostUid)
            ? invalidation.reason
            : readAuthInvalidUid(this.lostUid ?? '') ?? 'session-ended')
          : null;

        if (this.pending.value === VOLUNTARY_LOGOUT_NOTICE) {
          if (route.currentUrl === this.request?.target ||
              (uid && !terminating && this.session.currentAuthUser?.uid === uid)) {
            this.clearPending();
          }
          return;
        }

        if (route.requiresSession && reason) {
          const target = this.showPending(reason, route.currentUrl);
          if (!this.loginFailed.value) void this.goToLogin(target);
        } else {
          this.clearPending();
          // Se o Firebase publicou null antes de rejeitar reload, a causa
          // conhecida pode chegar quando a tela de login já está aberta.
          if (route.navPath === '/login' && ended && reason && reason !== 'session-ended' &&
              this.router.parseUrl(route.currentUrl).queryParams['reason'] === 'session-ended') {
            const redirect = this.router.parseUrl(route.currentUrl).queryParams['redirectTo'];
            void this.goToLogin(this.loginDestination(reason, typeof redirect === 'string' ? redirect : undefined));
          }
        }
      }
    );
  }

  markSignedOut(): void {
    this.previousUid = null;
    this.lostUid = null;
    this.showPending(VOLUNTARY_LOGOUT_NOTICE);
  }

  openAfterLogout$(): Observable<void> {
    return defer(() => this.destination ? from(this.goToLogin(this.destination)) : of(void 0));
  }

  retryLogin(): void {
    if (!this.loginFailed.value) return;
    if (this.accountSwitch) {
      const uid = this.session.currentAuthUser?.uid ?? null;
      if (uid) this.injector.get(PostAuthNavigationService).retryProfileLookup();
      this.openCurrentAccount(uid);
    }
    else if (this.destination) void this.goToLogin(this.destination);
  }

  private openCurrentAccount(uid: string | null): void {
    const transition = { uid };
    this.accountSwitch = transition;
    this.destination = null;
    this.loginFailed.next(false);
    this.pending.next(ACCOUNT_SWITCH_NOTICE);
    this.dialog.closeAll();
    void this.navigateToCurrentAccount(transition);
  }

  private async navigateToCurrentAccount(transition: { uid: string | null }): Promise<void> {
    const isCurrent = () => this.accountSwitch === transition &&
      (this.session.currentAuthUser?.uid ?? null) === transition.uid &&
      !this.session.isTerminatingSnapshot;
    const neutral = this.router.serializeUrl(this.router.createUrlTree(['/login'], {
      queryParams: { reason: AUTH_UNAVAILABLE_REASON },
    }));

    try {
      if (!isCurrent()) return;
      // Se o destino da conta atual coincidir com a rota anterior, o Router
      // poderia reutilizar a tela e o formulário. Saímos dela antes de retomar.
      if (this.router.url !== neutral) {
        await firstValueFrom(defer(() => this.router.navigateByUrl(neutral, {
          replaceUrl: true,
          info: ACCOUNT_SWITCH_DEACTIVATION,
        })).pipe(timeout({ first: LOGIN_NAVIGATION_TIMEOUT_MS })));
        if (!isCurrent()) return;
        if (this.router.url !== neutral) throw new Error('Account switch deactivation cancelled');
      }

      const invalidation = this.appBlock.invalidationSnapshot;
      const reason = transition.uid
        ? invalidation?.uid === transition.uid ? invalidation.reason : undefined
        : 'session-ended';
      const target = transition.uid && !reason
        ? await firstValueFrom(this.injector.get(PostAuthNavigationService)
          .resolveForCurrentSession$(transition.uid, CURRENT_ACCOUNT_HOME))
        : this.loginDestination(reason, transition.uid ? CURRENT_ACCOUNT_HOME : undefined);
      if (!isCurrent()) return;
      const navigated = await firstValueFrom(defer(() =>
        this.router.navigateByUrl(target, { replaceUrl: true })
      ).pipe(timeout({ first: LOGIN_NAVIGATION_TIMEOUT_MS })));
      if (!isCurrent()) return;

      const finalUrl = this.router.parseUrl(this.router.url);
      const finalReason = finalUrl.queryParams['reason'];
      const onLogin = this.router.url.split(/[?#]/)[0] === '/login';
      const currentInvalidation = this.appBlock.invalidationSnapshot;
      const requiresRecovery = transition.uid && onLogin && currentInvalidation?.uid !== transition.uid;
      if (!navigated || finalReason === AUTH_UNAVAILABLE_REASON || requiresRecovery) {
        throw new Error('Account switch navigation could not be completed');
      }
      this.clearPending();
    } catch (error: unknown) {
      if (!isCurrent()) return;
      this.loginFailed.next(true);
      this.reportNavigationFailure(error, true);
    }
  }

  private loginDestination(reason?: LoginExitReason, redirectTo?: string): UrlTree {
    return this.router.createUrlTree(['/login'], { queryParams: { reason, redirectTo } });
  }

  private showPending(reason: LoginExitReason, redirectTo?: string): UrlTree {
    const tree = this.loginDestination(reason, redirectTo);
    if (this.destination && this.router.serializeUrl(this.destination) === this.router.serializeUrl(tree)) {
      return this.destination;
    }
    this.accountSwitch = null;
    this.destination = tree;
    this.loginFailed.next(false);
    this.pending.next(reason);
    return tree;
  }

  private clearPending(): void {
    if (!this.pending.value) return;
    this.destination = null;
    this.accountSwitch = null;
    this.loginFailed.next(false);
    this.pending.next(null);
  }

  private goToLogin(tree: UrlTree): Promise<void> {
    const target = this.router.serializeUrl(tree);
    if (this.request?.target === target) return this.request.done;

    const done = firstValueFrom(defer(() =>
      this.router.navigateByUrl(tree, { replaceUrl: true })
    ).pipe(timeout({ first: LOGIN_NAVIGATION_TIMEOUT_MS }))).then((navigated) => {
      if (!navigated && this.router.url !== target) throw new Error('Login navigation cancelled');
      if (this.destination === tree) this.clearPending();
    }).catch((error: unknown) => {
      if (this.request?.done === done) this.request = null;
      if (this.destination === tree) this.loginFailed.next(true);
      this.reportNavigationFailure(error);
    }).finally(() => {
      if (this.request?.done === done) this.request = null;
    });

    this.request = { target, done };
    this.loginFailed.next(false);
    return done;
  }

  private reportNavigationFailure(error: unknown, switchingAccount = false): void {
    try {
      this.errors.report(error, {
        feature: 'authentication',
        operation: switchingAccount ? 'navigateAfterAccountSwitch' : 'openLoginAfterSessionLoss',
        fallbackMessage: switchingAccount
          ? 'Não foi possível abrir a sessão da conta atual.'
          : 'Não foi possível abrir a tela de login.',
        presentation: { surface: 'none', severity: 'error' },
      });
    } catch {
      // Mantém a ação de recuperação disponível.
    }
  }
}

/** Permite sair da tela protegida e conservar o rascunho na transição de sessão. */
export function canLeaveAfterSessionEnded(nextUrl: string | undefined): boolean {
  if (nextUrl?.split(/[?#]/)[0] !== '/login') return false;
  if (inject(Router, { optional: true })?.currentNavigation()?.extras.info === ACCOUNT_SWITCH_DEACTIVATION) {
    return true;
  }
  const session = inject(AuthSessionService);
  const block = inject(AuthAppBlockService);
  const uid = session.currentAuthUser?.uid;
  return !uid || (block.snapshot === 'auth-invalid' && block.invalidationSnapshot?.uid === uid);
}
