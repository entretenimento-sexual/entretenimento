import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { AuthAppBlockService } from './auth-app-block.service';
import { AuthRouteContextService } from './auth-route-context.service';
import { AuthSessionService } from './auth-session.service';
import type { SessionEndReason } from './auth.types';

export const VOLUNTARY_LOGOUT_NOTICE = 'signed-out';
type LoginExitReason = SessionEndReason | typeof VOLUNTARY_LOGOUT_NOTICE;
const LOGIN_NAVIGATION_TIMEOUT_MS = 12_000;

@Injectable({ providedIn: 'root' })
export class AuthSessionExitService {
  private readonly session = inject(AuthSessionService);
  private readonly appBlock = inject(AuthAppBlockService);
  private readonly routes = inject(AuthRouteContextService);
  private readonly router = inject(Router);
  private readonly errors = inject(ApplicationErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pending = new BehaviorSubject<LoginExitReason | null>(null);
  readonly pending$ = this.pending.asObservable();
  private readonly loginFailed = new BehaviorSubject(false);
  readonly loginFailed$ = this.loginFailed.asObservable();

  private started = false;
  private previousUid: string | null = null;
  private lostUid: string | null = null;
  private destination: UrlTree | null = null;
  private request: { target: string; done: Promise<void> } | null = null;

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

        if (uid && !terminating) {
          this.previousUid = uid;
          this.lostUid = null;
        } else if (this.previousUid && !terminating) {
          this.lostUid = this.previousUid;
          this.previousUid = null;
        } else if (terminating) {
          this.previousUid = null;
          this.lostUid = null;
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
    this.showPending(VOLUNTARY_LOGOUT_NOTICE);
  }

  openAfterLogout$(): Observable<void> {
    return defer(() => this.destination ? from(this.goToLogin(this.destination)) : of(void 0));
  }

  retryLogin(): void {
    if (this.destination && this.loginFailed.value) void this.goToLogin(this.destination);
  }

  private loginDestination(reason: LoginExitReason, redirectTo?: string): UrlTree {
    return this.router.createUrlTree(['/login'], { queryParams: { reason, redirectTo } });
  }

  private showPending(reason: LoginExitReason, redirectTo?: string): UrlTree {
    const tree = this.loginDestination(reason, redirectTo);
    if (this.destination && this.router.serializeUrl(this.destination) === this.router.serializeUrl(tree)) {
      return this.destination;
    }
    this.destination = tree;
    this.loginFailed.next(false);
    this.pending.next(reason);
    return tree;
  }

  private clearPending(): void {
    if (!this.pending.value) return;
    this.destination = null;
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
      try {
        this.errors.report(error, {
          feature: 'authentication',
          operation: 'openLoginAfterSessionLoss',
          fallbackMessage: 'Não foi possível abrir a tela de login.',
          presentation: { surface: 'none', severity: 'error' },
        });
      } catch {
        // Mantém a ação de recuperação disponível.
      }
    }).finally(() => {
      if (this.request?.done === done) this.request = null;
    });

    this.request = { target, done };
    this.loginFailed.next(false);
    return done;
  }
}

/** Permite sair da tela protegida e conservar o rascunho após a perda da sessão. */
export function canLeaveAfterSessionEnded(nextUrl: string | undefined): boolean {
  if (nextUrl?.split(/[?#]/)[0] !== '/login') return false;
  const session = inject(AuthSessionService);
  const block = inject(AuthAppBlockService);
  const uid = session.currentAuthUser?.uid;
  return !uid || (block.snapshot === 'auth-invalid' && block.invalidationSnapshot?.uid === uid);
}
