// src/app/core/services/autentication/auth/access-control.service.ts
// Serviço central de controle de acesso/capacidades.
//
// Regra arquitetural principal:
//
// - profileCompleted:
//   indica que o usuário concluiu o perfil mínimo obrigatório da plataforma.
//   Deve controlar entrada no núcleo do app e navegação principal.
//
// - emailVerified:
//   indica que o usuário confirmou o canal de e-mail.
//   Deve controlar recursos sensíveis, como chat, convites, interações fortes,
//   confiança da conta e maior precisão de localização.
//
// Importante:
// - Completar perfil NÃO deve depender de e-mail verificado.
// - Verificar e-mail NÃO deve marcar perfil como completo.
// - Um usuário com profileCompleted=true e emailVerified=false é um estado válido.
//
// Fontes:
// - AuthSessionService: sessão / uid / ready / emailVerified
// - CurrentUserStoreService: perfil runtime do app
// - AuthAppBlockService: bloqueio explícito do app
// - AuthRouteContextService: contexto canônico de rota/auth-flow

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

  /**
   * Diagnóstico auxiliar.
   *
   * Não substitui profileCompleted.
   * Serve para debug e eventuais fluxos de recuperação/migração.
   */
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
  // Router context
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
   * - undefined => perfil ainda hidratando
   * - null => sessão resolvida sem perfil disponível
   * - IUserDados => perfil runtime carregado
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

  /**
   * Verdade canônica de e-mail verificado.
   *
   * Não deve ser usada para decidir se o perfil está completo.
   */
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
   * Verdade canônica de perfil concluído.
   *
   * Não deve ser usada para dizer se o e-mail foi verificado.
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
   * Compatibilidade pública.
   *
   * Importante:
   * profileEligible$ agora representa somente profileCompleted$.
   * Não inclui emailVerified.
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

    /**
   * Indica quando a rota atual realmente consome a listagem de perfis online.
   *
   * A presença do próprio usuário continua sendo infraestrutura global.
   * Este recorte controla apenas a escuta/hidratação de outros usuários
   * necessária às telas de descoberta.
   *
   * Rotas preservadas:
   * - /dashboard/explorar: página canônica de descoberta;
   * - /dashboard/online: rota legada de online;
   * - /dashboard/online-users: painel compacto ainda existente.
   */
  private isOnlineUsersConsumptionRoute(url: string | null | undefined): boolean {
    const normalizedUrl = String(url ?? '')
      .split('?')[0]
      .split('#')[0]
      .replace(/\/+$/, '');

    return (
      normalizedUrl === '/dashboard/explorar' ||
      normalizedUrl.startsWith('/dashboard/explorar/') ||
      normalizedUrl === '/dashboard/online' ||
      normalizedUrl.startsWith('/dashboard/online/') ||
      normalizedUrl === '/dashboard/online-users' ||
      normalizedUrl.startsWith('/dashboard/online-users/')
    );
  }
  // ---------------------------------------------------------------------------
  // Gates
  // ---------------------------------------------------------------------------

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

  /**
   * Infra realtime:
   * sessão autenticada, fora do fluxo de registro e app liberado.
   *
   * Não exige profileCompleted nem emailVerified.
   * Serve para infraestrutura neutra.
   */
  readonly canRunInfraRealtime$: Observable<boolean> = combineLatest([
    this.canRunApp$,
    this.ready$,
    this.authUid$,
    this.inRegistrationFlow$,
  ]).pipe(
    map(([canRunApp, ready, uid, inReg]) =>
      canRunApp === true &&
      ready === true &&
      !!uid &&
      inReg === false
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunInfraRealtime$', false))
  );

  /**
   * Presença é infraestrutura de sessão.
   * Não deve depender de e-mail verificado.
   */
  readonly canRunPresence$: Observable<boolean> = this.canRunInfraRealtime$;

  /**
   * Chat é recurso sensível:
   * exige perfil completo + e-mail verificado.
   */
  readonly canRunChatRealtime$: Observable<boolean> = combineLatest([
    this.canRunInfraRealtime$,
    this.profileEligible$,
    this.emailVerified$,
  ]).pipe(
    map(([infraOk, profileOk, emailOk]) =>
      infraOk === true &&
      profileOk === true &&
      emailOk === true
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunChatRealtime$', false))
  );

  /**
   * Discovery/Online Users:
   * exige perfil completo, mas não exige e-mail verificado.
   *
   * O e-mail não verificado deve entrar na policy de limitação:
   * raio menor, menor precisão, interações bloqueadas etc.
   */
  readonly canRunDiscoveryRealtime$: Observable<boolean> = combineLatest([
    this.canRunInfraRealtime$,
    this.profileEligible$,
  ]).pipe(
    map(([infraOk, profileOk]) =>
      infraOk === true &&
      profileOk === true
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunDiscoveryRealtime$', false))
  );

  /**
   * Recursos sensíveis genéricos.
   *
   * Use este gate para features que exponham interação forte entre usuários.
   */
  readonly canRunSensitiveRealtime$: Observable<boolean> = combineLatest([
    this.canRunDiscoveryRealtime$,
    this.emailVerified$,
  ]).pipe(
    map(([discoveryOk, emailOk]) =>
      discoveryOk === true &&
      emailOk === true
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunSensitiveRealtime$', false))
  );

  /**
   * Mantido por compatibilidade.
   *
   * Interpretação:
   * canRunProductRealtime$ = produto sensível.
   * Para discovery/online use canRunDiscoveryRealtime$ ou canRunOnlineUsers$.
   */
  readonly canRunProductRealtime$: Observable<boolean> =
    this.canRunSensitiveRealtime$.pipe(
      distinctUntilChanged(),

      tap((can) => {
        if (!this.debug) {
          return;
        }

        const user = this.currentUserStore.getSnapshot() as any;

        this.dbg('canRunProductRealtime$', {
          can,
          uid: user?.uid,
          profileCompleted: user?.profileCompleted,
          emailVerified: this.session.currentAuthUser?.emailVerified ?? null,
          accountStatus: user?.accountStatus,
        });
      }),

      shareReplay({ bufferSize: 1, refCount: true }),
      catchError(this.handleStreamError('canRunProductRealtime$', false))
    );

  /**
   * Listener de outros usuários online.
   *
   * Diferente da presença do próprio usuário, esta escuta só deve existir em
   * rotas que realmente exibem cards ou modos de descoberta.
   */
  readonly canRunOnlineUsers$: Observable<boolean> = combineLatest([
    this.canRunInfraRealtime$,
    this.profileEligible$,
    this.authUid$,
    this.routeCtx$,
  ]).pipe(
    map(([infraOk, profileEligible, uid, routeCtx]) => {
      const routeConsumesOnlineUsers =
        routeCtx.routerReady === true &&
        this.isOnlineUsersConsumptionRoute(routeCtx.currentUrl);

      return {
        can:
          infraOk === true &&
          profileEligible === true &&
          !!uid &&
          routeConsumesOnlineUsers,
        url: routeCtx.currentUrl,
        routerReady: routeCtx.routerReady,
        routeConsumesOnlineUsers,
      };
    }),

    distinctUntilChanged(
      (previous, current) =>
        previous.can === current.can &&
        previous.url === current.url &&
        previous.routerReady === current.routerReady &&
        previous.routeConsumesOnlineUsers === current.routeConsumesOnlineUsers
    ),

    tap(({ can, url, routerReady, routeConsumesOnlineUsers }) => {
      if (!this.debug || !routerReady) {
        return;
      }

      const user = this.currentUserStore.getSnapshot() as any;

      this.dbg('canRunOnlineUsers$', {
        can,
        url,
        routeConsumesOnlineUsers,
        uid: user?.uid,
        profileCompleted: user?.profileCompleted,
        emailVerified: this.session.currentAuthUser?.emailVerified ?? null,
      });
    }),

    map(({ can }) => can),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canRunOnlineUsers$', false))
  );

  // ---------------------------------------------------------------------------
  // Capacidades de alto nível
  // ---------------------------------------------------------------------------

  /**
   * Entrada no núcleo do app.
   *
   * Corrigido:
   * - NÃO exige emailVerified.
   * - Exige apenas sessão, profileCompleted e conta não bloqueada.
   */
  readonly canEnterCore$: Observable<boolean> = combineLatest([
    this.isAuthenticated$,
    this.profileCompleted$,
    this.isBlocked$,
  ]).pipe(
    map(([isAuth, profileCompleted, blocked]) =>
      isAuth === true &&
      profileCompleted === true &&
      blocked === false
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canEnterCore$', false))
  );

  /**
   * Compatibilidade.
   *
   * Mantido apontando para produto sensível.
   * Quando precisar de listeners não sensíveis, use canRunDiscoveryRealtime$.
   */
  readonly canListenRealtime$: Observable<boolean> = this.canRunProductRealtime$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError(this.handleStreamError('canListenRealtime$', false))
  );

  /**
   * Etapas de registro/onboarding:
   * só exigem autenticação e ausência de bloqueio.
   */
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
} // Linha 783