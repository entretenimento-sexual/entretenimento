// src/app/core/services/autentication/auth/access-control.service.ts
// Serviço central de controle de acesso/capacidades.
//
// Verdades:
// - AuthSessionService: sessão / uid / ready / emailVerified
// - CurrentUserStoreService: perfil do app em runtime
// - AuthAppBlockService: bloqueio explícito do app
// - AuthRouteContextService: contexto canônico de rota/auth-flow
//
// Objetivo:
// - derivar gates simples e previsíveis
// - degradar sempre para "nega acesso" em caso de erro
// - incluir lifecycle da conta no gate global
// - reduzir recomputações e logs duplicados
//
// Observação arquitetural:
// - Este service NÃO recalcula contexto de rota.
// - O contexto de rota vem inteiro do AuthRouteContextService.
// - AuthSession manda na sessão.
// - CurrentUserStore manda no runtime do perfil do app.
// - accountStatus agora também participa do bloqueio efetivo do app.
//
import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  tap,
} from 'rxjs/operators';

import type { IUserDados } from '../../../interfaces/iuser-dados';
import type { TerminateReason } from './auth.types';
import type { AuthRouteContext } from './auth-route-context.service';

import { AuthSessionService } from './auth-session.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { AuthAppBlockService } from './auth-app-block.service';
import { AuthRouteContextService } from './auth-route-context.service';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { environment } from 'src/environments/environment';

export type UserRole = IUserDados['role'];

export type AccessState =
  | 'GUEST'
  | 'AUTHED_PROFILE_INCOMPLETE'
  | 'AUTHED_PROFILE_COMPLETE_UNVERIFIED'
  | 'AUTHED_PROFILE_COMPLETE_VERIFIED'
  | 'AUTHED_PROFILE_COMPLETE_VERIFIED_AGE_PENDING'
  | 'AUTHED_PROFILE_COMPLETE_VERIFIED_AGE_BLOCKED'
  | 'AUTHED_PROFILE_COMPLETE_VERIFIED_AGE_OK';

type LifecycleAccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

const ROLE_RANK: Record<string, number> = {
  visitante: 0,
  free: 1,
  basic: 2,
  premium: 3,
  vip: 4,
};

@Injectable({ providedIn: 'root' })
export class AccessControlService {
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly appBlock = inject(AuthAppBlockService);
  private readonly routeContext = inject(AuthRouteContextService);

  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notify = inject(ErrorNotificationService);

  private _lastNotifyAt = 0;
  private readonly debug = !environment.production;

  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AccessControl] ${msg}`, extra ?? '');
  }

  private safeRank(role: unknown): number {
    const key = (role ?? 'visitante') as string;
    return ROLE_RANK[key] ?? ROLE_RANK['visitante'];
  }

  private safeRole(role: unknown): UserRole {
    const key = (role ?? 'visitante') as string;
    return (ROLE_RANK[key] != null ? key : 'visitante') as UserRole;
  }

  private hasMinProfileFields(anyU: any): boolean {
    const gender = (anyU?.gender ?? anyU?.genero ?? anyU?.sexo) as unknown;
    const estado = (anyU?.estado ?? anyU?.state) as unknown;
    const municipio = (anyU?.municipio ?? anyU?.cidade ?? anyU?.city) as unknown;

    return (
      typeof gender === 'string' &&
      gender.trim() !== '' &&
      typeof estado === 'string' &&
      estado.trim() !== '' &&
      typeof municipio === 'string' &&
      municipio.trim() !== ''
    );
  }

  private normalizeAccountStatus(
    user: IUserDados | null | undefined
  ): LifecycleAccountStatus {
    const raw = String((user as any)?.accountStatus ?? '')
      .trim()
      .toLowerCase();

    if (
      raw === 'active' ||
      raw === 'self_suspended' ||
      raw === 'moderation_suspended' ||
      raw === 'pending_deletion' ||
      raw === 'deleted'
    ) {
      return raw;
    }

    /**
     * Compatibilidade com camada legada:
     * - se ainda existir só `suspended === true`
     * - tentamos inferir o tipo de suspensão
     */
    if ((user as any)?.suspended === true) {
      return (user as any)?.suspensionSource === 'self'
        ? 'self_suspended'
        : 'moderation_suspended';
    }

    return 'active';
  }

  private isLifecycleBlockedStatus(status: LifecycleAccountStatus): boolean {
    return status !== 'active';
  }

  private normalizeSubscriptionStatus(user: IUserDados | null | undefined): string {
    return String((user as any)?.subscriptionStatus ?? '')
      .trim()
      .toLowerCase();
  }

  private handleStreamError<T>(
    context: string,
    fallback: T
  ): (err: unknown) => Observable<T> {
    return (err: unknown) => {
      const e =
        err instanceof Error
          ? err
          : new Error(`AccessControlService stream error: ${context}`);

      (e as any).silent = true;
      (e as any).original = err;
      (e as any).context = context;
      (e as any).skipUserNotification = true;

      this.globalError.handleError(e);

      const now = Date.now();
      if (now - this._lastNotifyAt > 15_000) {
        this._lastNotifyAt = now;
        this.notify.showError('Falha ao validar acesso. Tente novamente.');
      }

      return of(fallback);
    };
  }

  // ---------------------------------------------------------------------------
  // Router context (fonte única: AuthRouteContextService)
  // ---------------------------------------------------------------------------

  private readonly routeCtx$: Observable<AuthRouteContext> = this.routeContext.context$.pipe(
    distinctUntilChanged(
      (a, b) =>
        a.routerReady === b.routerReady &&
        a.currentUrl === b.currentUrl &&
        a.navPath === b.navPath &&
        a.inRegistrationFlow === b.inRegistrationFlow
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(
      this.handleStreamError<AuthRouteContext>('routeCtx$', {
        routerReady: false,
        currentUrl: '/',
        navPath: null,
        inRegistrationFlow: true,
      })
    )
  );

  readonly currentUrl$: Observable<string> = this.routeCtx$.pipe(
    map((ctx) => ctx.currentUrl),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('currentUrl$', '/'))
  );

  readonly routerReady$: Observable<boolean> = this.routeCtx$.pipe(
    map((ctx) => ctx.routerReady),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('routerReady$', false))
  );

  readonly inRegistrationFlow$: Observable<boolean> = this.routeCtx$.pipe(
    map((ctx) => ctx.inRegistrationFlow),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('inRegistrationFlow$', true))
  );

  // ---------------------------------------------------------------------------
  // Base streams
  // ---------------------------------------------------------------------------

  readonly ready$: Observable<boolean> = this.session.ready$.pipe(
    startWith(false),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('ready$', false))
  );

  readonly authUser$ = this.session.authUser$.pipe(
    startWith(null),
    distinctUntilChanged(
      (a, b) =>
        (a?.uid ?? null) === (b?.uid ?? null) &&
        (a?.emailVerified ?? false) === (b?.emailVerified ?? false)
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('authUser$', null))
  );

  readonly authUid$: Observable<string | null> = this.authUser$.pipe(
    map((u) => u?.uid ?? null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('authUid$', null))
  );

  /**
   * appUser$:
   * - undefined => runtime ainda está hidratando
   * - null => runtime resolveu que não há perfil disponível
   * - IUserDados => perfil disponível
   */
  readonly appUser$ = this.currentUserStore.user$.pipe(
    startWith(undefined),
    distinctUntilChanged((a, b) => {
      if (a === b) return true;
      if (a === undefined || b === undefined) return false;
      if (a === null || b === null) return false;

      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('appUser$', undefined))
  );

  readonly appUserResolved$: Observable<boolean> = this.appUser$.pipe(
    map((user) => user !== undefined),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('appUserResolved$', false))
  );

  readonly appUserAvailable$: Observable<boolean> = this.appUser$.pipe(
    map((user) => user !== undefined && user !== null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('appUserAvailable$', false))
  );

  readonly blockedReason$: Observable<TerminateReason | null> = this.appBlock.reason$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('blockedReason$', null))
  );

  // ---------------------------------------------------------------------------
  // Lifecycle da conta
  // ---------------------------------------------------------------------------

  readonly accountStatus$: Observable<LifecycleAccountStatus> = this.appUser$.pipe(
    map(
      (user): LifecycleAccountStatus =>
        this.normalizeAccountStatus(user as IUserDados | null | undefined)
    ),
    distinctUntilChanged(),
    tap((accountStatus) => {
      if (!this.debug) return;

      const user = this.currentUserStore.getSnapshot() as any;
      this.dbg('accountStatus$', {
        accountStatus,
        uid: user?.uid,
        rawAccountStatus: user?.accountStatus,
        suspended: user?.suspended,
        suspensionSource: user?.suspensionSource,
      });
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(
      this.handleStreamError<LifecycleAccountStatus>(
        'accountStatus$',
        'active'
      )
    )
  );

  readonly isLifecycleBlocked$: Observable<boolean> = this.accountStatus$.pipe(
    map((status) => this.isLifecycleBlockedStatus(status)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isLifecycleBlocked$', false))
  );

  /**
   * Bloqueio efetivo do app:
   * - bloqueio explícito via AuthAppBlockService
   * - OU lifecycle bloqueado da conta
   */
  readonly isBlocked$: Observable<boolean> = combineLatest([
    this.blockedReason$,
    this.isLifecycleBlocked$,
  ]).pipe(
    map(([reason, lifecycleBlocked]) => !!reason || lifecycleBlocked),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isBlocked$', false))
  );

  // ---------------------------------------------------------------------------
  // Sessão / perfil
  // ---------------------------------------------------------------------------

  readonly isAuthenticated$: Observable<boolean> = combineLatest([
    this.ready$,
    this.authUid$,
  ]).pipe(
    map(([ready, uid]) => ready === true && !!uid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isAuthenticated$', false))
  );

  readonly emailVerified$: Observable<boolean> = combineLatest([
    this.ready$,
    this.authUser$,
  ]).pipe(
    map(([ready, user]) => ready === true && !!user?.uid && user.emailVerified === true),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('emailVerified$', false))
  );

  /**
   * Verdade canônica de "perfil concluído".
   * Esta stream governa os gates de produto.
   */
  readonly profileCompleted$: Observable<boolean> = combineLatest([
    this.isAuthenticated$,
    this.appUserResolved$,
    this.appUser$,
  ]).pipe(
    map(([isAuth, resolved, user]) => {
      if (!isAuth) return false;
      if (!resolved) return false;
      if (user === null) return false;
      return (user as any)?.profileCompleted === true;
    }),
    distinctUntilChanged(),
    tap((completed) => {
      if (!this.debug) return;

      const user = this.currentUserStore.getSnapshot() as any;
      this.dbg('profileCompleted$', {
        completed,
        uid: user?.uid,
        profileCompleted: user?.profileCompleted,
      });
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('profileCompleted$', false))
  );

  /**
   * Diagnóstico apenas.
   * Não governa o gate final do produto.
   */
  readonly hasMinimalProfileData$: Observable<boolean> = combineLatest([
    this.isAuthenticated$,
    this.appUserResolved$,
    this.appUser$,
  ]).pipe(
    map(([isAuth, resolved, user]) => {
      if (!isAuth) return false;
      if (!resolved) return false;
      if (user === null) return false;
      return this.hasMinProfileFields(user);
    }),
    distinctUntilChanged(),
    tap((hasMin) => {
      if (!this.debug) return;

      const user = this.currentUserStore.getSnapshot() as any;
      this.dbg('hasMinimalProfileData$', {
        hasMin,
        uid: user?.uid,
        gender: user?.gender,
        estado: user?.estado,
        municipio: user?.municipio,
      });
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('hasMinimalProfileData$', false))
  );

  /**
   * Compatibilidade pública:
   * profileEligible$ passa a espelhar profileCompleted$.
   */
  readonly profileEligible$: Observable<boolean> = this.profileCompleted$;

  // ---------------------------------------------------------------------------
  // Estado consolidado
  // ---------------------------------------------------------------------------

  readonly state$: Observable<AccessState> = combineLatest([
    this.isAuthenticated$,
    this.profileCompleted$,
    this.emailVerified$,
  ]).pipe(
    map(([isAuth, profileOk, emailOk]) => {
      if (!isAuth) return 'GUEST';
      if (!profileOk) return 'AUTHED_PROFILE_INCOMPLETE';
      if (!emailOk) return 'AUTHED_PROFILE_COMPLETE_UNVERIFIED';
      return 'AUTHED_PROFILE_COMPLETE_VERIFIED';
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('state$', 'GUEST' as AccessState))
  );

  // ---------------------------------------------------------------------------
  // Gates
  // ---------------------------------------------------------------------------

  /**
   * Gate global do app:
   * - router pronto
   * - sem bloqueio explícito
   * - sem lifecycle bloqueado
   */
  readonly canRunApp$: Observable<boolean> = combineLatest([
    this.routerReady$,
    this.isBlocked$,
  ]).pipe(
    map(([routerReady, blocked]) => routerReady === true && blocked === false),
    distinctUntilChanged(),
    tap((canRunApp) => {
      if (!this.debug) return;

      const user = this.currentUserStore.getSnapshot() as any;
      this.dbg('canRunApp$', {
        canRunApp,
        uid: user?.uid,
        accountStatus: user?.accountStatus,
      });
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunApp$', false))
  );

  readonly canRunInfraRealtime$: Observable<boolean> = combineLatest([
    this.canRunApp$,
    this.ready$,
    this.authUid$,
    this.inRegistrationFlow$,
  ]).pipe(
    map(([canRunApp, ready, uid, inReg]) => canRunApp && ready && !!uid && inReg === false),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunInfraRealtime$', false))
  );

  readonly canRunChatRealtime$: Observable<boolean> = combineLatest([
    this.canRunInfraRealtime$,
    this.emailVerified$,
  ]).pipe(
    map(([infraOk, emailOk]) => infraOk && emailOk),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunChatRealtime$', false))
  );

  /**
   * Presença é infraestrutura de sessão.
   * Mantemos alinhada ao gate infra.
   */
  readonly canRunPresence$: Observable<boolean> = this.canRunInfraRealtime$;

  readonly canRunProductRealtime$: Observable<boolean> = combineLatest([
    this.canRunInfraRealtime$,
    this.emailVerified$,
    this.profileEligible$,
  ]).pipe(
    map(([infraOk, emailOk, profileEligible]) => infraOk && emailOk && profileEligible),
    distinctUntilChanged(),
    tap((can) => {
      if (!this.debug) return;

      const user = this.currentUserStore.getSnapshot() as any;
      this.dbg('canRunProductRealtime$', {
        can,
        uid: user?.uid,
        profileCompleted: user?.profileCompleted,
        accountStatus: user?.accountStatus,
      });
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunProductRealtime$', false))
  );

  /**
   * Gate final de OnlineUsers:
   * - depende do gate de produto
   * - exige uid
   * - exige perfil runtime resolvido e disponível
   * - exige match entre appUser.uid e authUid
   *
   * Observação:
   * - Mantemos a URL junto apenas para debug do gate.
   * - A saída pública continua sendo boolean.
   */
  readonly canRunOnlineUsers$: Observable<boolean> = combineLatest([
    this.canRunProductRealtime$,
    this.authUid$,
    this.appUserResolved$,
    this.appUser$,
    this.routeCtx$,
  ]).pipe(
    map(([canRunProduct, uid, resolved, appUser, routeCtx]) => {
      let can = true;

      if (!canRunProduct) can = false;
      else if (!uid) can = false;
      else if (!resolved) can = false;
      else if (appUser === null) can = false;
      else {
        const appUid = (appUser as any)?.uid;
        if (typeof appUid === 'string' && appUid && appUid !== uid) {
          can = false;
        }
      }

      return {
        can,
        url: routeCtx.currentUrl,
        routerReady: routeCtx.routerReady,
      };
    }),
    distinctUntilChanged(
      (a, b) =>
        a.can === b.can &&
        a.url === b.url &&
        a.routerReady === b.routerReady
    ),
    tap(({ can, url, routerReady }) => {
      if (!this.debug) return;
      if (!routerReady) return;

      this.dbg('canRunOnlineUsers$', { can, url });
    }),
    map(({ can }) => can),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunOnlineUsers$', false))
  );

  // ---------------------------------------------------------------------------
  // Capacidades de alto nível
  // ---------------------------------------------------------------------------

  readonly canEnterCore$: Observable<boolean> = combineLatest([
    this.state$,
    this.isBlocked$,
  ]).pipe(
    map(([state, blocked]) => state === 'AUTHED_PROFILE_COMPLETE_VERIFIED' && !blocked),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canEnterCore$', false))
  );

  readonly canListenRealtime$: Observable<boolean> = this.canRunProductRealtime$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canListenRealtime$', false))
  );

  readonly canEnterRegistrationSteps$: Observable<boolean> = combineLatest([
    this.isAuthenticated$,
    this.isBlocked$,
  ]).pipe(
    map(([isAuth, blocked]) => !!isAuth && !blocked),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canEnterRegistrationSteps$', false))
  );

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------

  private readonly role$: Observable<UserRole> = this.appUser$.pipe(
    map((user) => this.safeRole((user as any)?.role ?? 'visitante')),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('role$', 'visitante' as UserRole))
  );

  hasAtLeast$(min: UserRole): Observable<boolean> {
    return this.role$.pipe(
      map((role) => this.safeRank(role) >= this.safeRank(min)),
      distinctUntilChanged(),
      catchError(this.handleStreamError(`hasAtLeast$(${String(min)})`, false))
    );
  }

  hasAny$(allowed: UserRole[]): Observable<boolean> {
    const allowedSet = new Set((allowed ?? []).map((item) => String(item)));

    return this.role$.pipe(
      map((role) => allowedSet.has(String(role))),
      distinctUntilChanged(),
      catchError(this.handleStreamError('hasAny$', false))
    );
  }

  // ---------------------------------------------------------------------------
  // Conveniências
  // ---------------------------------------------------------------------------

  readonly isFree$: Observable<boolean> = combineLatest([
    this.isAuthenticated$,
    this.appUser$,
  ]).pipe(
    map(([isAuth, user]) => {
      if (!isAuth) return true;

      const subscriptionStatus = this.normalizeSubscriptionStatus(user as IUserDados | null);
      const isSubscriber = (user as any)?.isSubscriber === true;

      return !(isSubscriber || subscriptionStatus === 'active');
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isFree$', true))
  );

  readonly isSubscriber$: Observable<boolean> = this.appUser$.pipe(
    map((user) => {
      const subscriptionStatus = this.normalizeSubscriptionStatus(user as IUserDados | null);
      return (user as any)?.isSubscriber === true || subscriptionStatus === 'active';
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('isSubscriber$', false))
  );
}