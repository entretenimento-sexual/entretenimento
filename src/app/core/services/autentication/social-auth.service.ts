// src/app/core/services/autentication/social-auth.service.ts
// =============================================================================
// SOCIAL AUTH SERVICE (Google Sign-In) — Auth + Firestore
//
// Responsabilidade deste service:
// - autenticar via Google no Firebase Auth
// - ler o users/{uid} no Firestore (server-first)
// - criar seed mínima para novo usuário
// - atualizar campos operacionais seguros do usuário existente
// - devolver um resultado ESTRUTURADO para a camada chamadora decidir:
//   - rota
//   - feedback visual
//   - próximas ações
//
// NÃO é responsabilidade deste service:
// - navegar
// - hidratar CurrentUserStoreService
// - atualizar cache/store manualmente
// - iniciar watchers
// - executar logout
//
// Observação arquitetural:
// - Sessão continua sendo verdade do AuthSessionService
// - Runtime de perfil continua sendo verdade do fluxo oficial do projeto
// - Este service apenas autentica + persiste + devolve resultado
// =============================================================================

import {
  EnvironmentInjector,
  Injectable,
  runInInjectionContext,
} from '@angular/core';

import { Auth } from '@angular/fire/auth';
import {
  GoogleAuthProvider,
  signInWithPopup,
  type User as FirebaseUser,
  type UserCredential,
} from 'firebase/auth';

import { Observable, defer, of } from 'rxjs';
import {
  catchError,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { FirestoreReadService } from '../data-handling/firestore/core/firestore-read.service';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { toEpochOrZero } from 'src/app/core/utils/epoch-utils';
import { environment } from 'src/environments/environment';
import {
  AccountStatus,
  DEFAULT_ACCESS_CONTROL,
  IUserAccessControl,
  Tier,
} from '../../interfaces/interfaces-user-dados/user-access-control.interface';

// -----------------------------------------------------------------------------
// Tipos públicos de resultado
// -----------------------------------------------------------------------------

export type SocialAuthBlockReason = 'deleted' | 'suspended' | 'locked';

export type SocialAuthOutcome =
  | 'profile-ready'
  | 'profile-incomplete'
  | 'blocked'
  | 'cancelled'
  | 'error';

export type SocialAuthNextRoute =
  | '/dashboard/principal'
  | '/register/finalizar-cadastro'
  | '/login';

export interface SocialAuthResult {
  success: boolean;
  outcome: SocialAuthOutcome;
  isNewUser: boolean;
  emailVerified: boolean;
  user: IUserDados | null;
  nextRoute: SocialAuthNextRoute | null;
  blockedReason?: SocialAuthBlockReason;
  code?: string;
  message?: string;
}

// -----------------------------------------------------------------------------
// Documento real de users/{uid}
// - Mantido amplo o suficiente para evolução futura
// - Sem misturar responsabilidade de runtime/cache aqui
//
// IMPORTANTE:
// - photoURL aqui fica alinhado ao contrato de IUserRegistrationData:
//   string | undefined
// - null só deve existir no mapper de saída para IUserDados, se necessário
// -----------------------------------------------------------------------------

type SocialAuthUserDoc = IUserRegistrationData & {
  uid: string;
  email: string;
  nickname: string;
  photoURL?: string;

  emailVerified: boolean;
  profileCompleted: boolean;
  isSubscriber: boolean;

  /**
   * O projeto atual ainda consome role em vários pontos.
   * Mantemos o espelho porque remover isso agora quebraria a integração.
   * O canônico futuro continua sendo tier.
   */
  role?: IUserDados['role'];
  tier?: Tier;

  firstLogin?: number | null;
  registrationDate?: number | null;
  lastLogin?: number | null;
  createdAt?: number | null;
  updatedAtMs?: number | null;

  roles?: string[];
  permissions?: string[];
  entitlements?: string[];
  accountStatus?: AccountStatus;

  suspended?: boolean;
  accountLocked?: boolean;

  authProviders?: string[];
  lastProvider?: string;
};

@Injectable({ providedIn: 'root' })
export class SocialAuthService {
  private readonly debug = !environment.production && !!environment.enableDebugTools;

  constructor(
    private readonly auth: Auth,
    private readonly read: FirestoreReadService,
    private readonly write: FirestoreWriteService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly envInjector: EnvironmentInjector
  ) {}

  // ===========================================================================
  // API pública
  // ===========================================================================

  /**
   * Fluxo principal de login com Google.
   *
   * Saída:
   * - devolve um resultado estruturado
   * - NÃO navega
   * - NÃO atualiza store/cache manualmente
   */
  googleLogin(): Observable<SocialAuthResult> {
    const provider = this.buildGoogleProvider();

    return this.signInWithPopupInCtx$(provider).pipe(
      switchMap((credential) => this.bootstrapUserAfterAuth$(credential)),
      catchError((err) => of(this.handleGoogleLoginError(err)))
    );
  }

  // ===========================================================================
  // Auth popup
  // ===========================================================================

  private buildGoogleProvider(): GoogleAuthProvider {
    const provider = new GoogleAuthProvider();

    /**
     * UX mais previsível:
     * - força escolha explícita de conta
     */
    provider.setCustomParameters({ prompt: 'select_account' });

    return provider;
  }

  private signInWithPopupInCtx$(
    provider: GoogleAuthProvider
  ): Observable<UserCredential> {
    return defer(() =>
      runInInjectionContext(this.envInjector, () => signInWithPopup(this.auth, provider))
    ).pipe(
      tap((credential) => {
        this.dbg('signInWithPopup:ok', {
          uid: credential?.user?.uid ?? null,
          providerId: credential?.providerId ?? 'google.com',
        });
      })
    );
  }

  // ===========================================================================
  // Bootstrap pós-auth
  // ===========================================================================

  private bootstrapUserAfterAuth$(
    credential: UserCredential
  ): Observable<SocialAuthResult> {
    const authUser = credential?.user;

    if (!authUser?.uid) {
      return of(
        this.makeErrorResult({
          code: 'social-auth/no-user',
          message: 'Não foi possível concluir a autenticação com Google.',
        })
      );
    }

    const nowMs = Date.now();

    /**
     * Server-first:
     * - evita cache stale no momento do login
     */
    return this.read
      .getDocument<SocialAuthUserDoc>('users', authUser.uid, { source: 'server' })
      .pipe(
        take(1),
        switchMap((doc) => {
          if (doc) {
            return this.handleExistingUserLogin$(doc, authUser, nowMs);
          }

          return this.handleNewUserLogin$(authUser, nowMs);
        }),
        catchError((err) => {
          this.reportSilent(err, {
            phase: 'bootstrapUserAfterAuth',
            uid: authUser.uid,
          });

          return of(
            this.makeErrorResult({
              code: 'social-auth/bootstrap-failed',
              message: 'Não foi possível preparar sua conta agora.',
            })
          );
        })
      );
  }

  // ===========================================================================
  // Novo usuário
  // ===========================================================================

  private handleNewUserLogin$(
    authUser: FirebaseUser,
    nowMs: number
  ): Observable<SocialAuthResult> {
    const seed = this.buildNewUserSeed(authUser, nowMs);
    const payload: Record<string, unknown> = { ...seed };

    return this.write
      .setDocument('users', authUser.uid, payload, {
        /**
         * merge=true deixa o fluxo idempotente e mais tolerante a retry,
         * sem exigir sobrescrita cega.
         */
        merge: true,
        context: 'SocialAuthService.handleNewUserLogin',
      })
      .pipe(
        map(() => {
          const user = this.mapToUserDados(seed, nowMs);

          return this.makeSuccessResult({
            outcome: 'profile-incomplete',
            isNewUser: true,
            emailVerified: !!authUser.emailVerified,
            user,
            nextRoute: '/register/finalizar-cadastro',
            message: 'Conta criada com Google. Finalize seu cadastro para continuar.',
          });
        }),
        tap((result) => {
          this.dbg('handleNewUserLogin:done', {
            uid: authUser.uid,
            outcome: result.outcome,
            nextRoute: result.nextRoute,
          });
        }),
        catchError((err) => {
          this.reportSilent(err, {
            phase: 'handleNewUserLogin',
            uid: authUser.uid,
          });

          return of(
            this.makeErrorResult({
              code: 'social-auth/new-user-write-failed',
              message: 'Não foi possível concluir a criação da conta com Google.',
            })
          );
        })
      );
  }

  private buildNewUserSeed(
    authUser: FirebaseUser,
    nowMs: number
  ): SocialAuthUserDoc {
    const acl: IUserAccessControl = {
      ...DEFAULT_ACCESS_CONTROL,
      tier: 'basic',
    };

    const providerIds = this.extractProviderIds(authUser);

    return {
      uid: authUser.uid,
      email: authUser.email ?? '',
      nickname: '',
      photoURL: this.normalizePhotoUrl(authUser.photoURL),

      emailVerified: !!authUser.emailVerified,
      isSubscriber: false,
      profileCompleted: false,

      /**
       * Mantido porque o contrato atual do app ainda consome role.
       * O canônico futuro é tier.
       */
      role: 'basic',
      tier: acl.tier,

      firstLogin: nowMs,
      registrationDate: nowMs,
      lastLogin: nowMs,
      createdAt: nowMs,
      updatedAtMs: nowMs,

      acceptedTerms: {
        accepted: false,
        date: nowMs,
      },

      roles: Array.isArray(acl.roles) ? acl.roles : ['user'],
      permissions: Array.isArray(acl.permissions) ? acl.permissions : [],
      entitlements: Array.isArray(acl.entitlements) ? acl.entitlements : [],
      accountStatus: acl.accountStatus ?? 'active',

      suspended: false,
      accountLocked: false,

      authProviders: providerIds,
      lastProvider: 'google.com',
    };
  }

  // ===========================================================================
  // Usuário existente
  // ===========================================================================

  private handleExistingUserLogin$(
    existing: SocialAuthUserDoc,
    authUser: FirebaseUser,
    nowMs: number
  ): Observable<SocialAuthResult> {
    const status = this.resolveAccountStatus(existing);

    if (status === 'deleted') {
      return of(
        this.makeBlockedResult({
          reason: 'deleted',
          user: this.mapToUserDados(existing, nowMs),
          message: 'Conta indisponível. Entre em contato com o suporte.',
        })
      );
    }

    if (status === 'suspended') {
      return of(
        this.makeBlockedResult({
          reason: 'suspended',
          user: this.mapToUserDados(existing, nowMs),
          message: 'Sua conta está suspensa temporariamente.',
        })
      );
    }

    if (status === 'locked') {
      return of(
        this.makeBlockedResult({
          reason: 'locked',
          user: this.mapToUserDados(existing, nowMs),
          message: 'Sua conta está bloqueada temporariamente.',
        })
      );
    }

    const patch = this.buildExistingUserPatch(existing, authUser, nowMs);
    const payload: Record<string, unknown> = { ...patch };

    return this.write
      .updateDocument('users', authUser.uid, payload, {
        context: 'SocialAuthService.handleExistingUserLogin',
      })
      .pipe(
        map(() => {
          const merged = { ...existing, ...patch } as SocialAuthUserDoc;
          const user = this.mapToUserDados(merged, nowMs);
          const needsFinish = this.needsProfileCompletion(merged);

          return this.makeSuccessResult({
            outcome: needsFinish ? 'profile-incomplete' : 'profile-ready',
            isNewUser: false,
            emailVerified: !!authUser.emailVerified,
            user,
            nextRoute: needsFinish
              ? '/register/finalizar-cadastro'
              : '/dashboard/principal',
            message: needsFinish
              ? 'Login com Google concluído. Finalize seu cadastro para continuar.'
              : 'Login com Google concluído com sucesso.',
          });
        }),
        tap((result) => {
          this.dbg('handleExistingUserLogin:done', {
            uid: authUser.uid,
            outcome: result.outcome,
            nextRoute: result.nextRoute,
          });
        }),
        catchError((err) => {
          this.reportSilent(err, {
            phase: 'handleExistingUserLogin',
            uid: authUser.uid,
          });

          return of(
            this.makeErrorResult({
              code: 'social-auth/existing-user-update-failed',
              message: 'Não foi possível atualizar os dados da conta agora.',
            })
          );
        })
      );
  }

  private buildExistingUserPatch(
    existing: SocialAuthUserDoc,
    authUser: FirebaseUser,
    nowMs: number
  ): Partial<SocialAuthUserDoc> {
    const tier = this.normalizeTier(existing.tier ?? existing.role ?? 'basic');
    const providerIds = this.mergeProviderIds(existing.authProviders, authUser);

    return {
      lastLogin: nowMs,
      updatedAtMs: nowMs,

      emailVerified: !!authUser.emailVerified,
      photoURL:
        this.normalizePhotoUrl(authUser.photoURL) ??
        this.normalizePhotoUrl(existing.photoURL),

      /**
       * Mantido para o contrato atual do projeto.
       * Quando o app migrar totalmente para tier, esse espelho pode sair.
       */
      role: this.normalizeRole(existing.role ?? tier),
      tier,

      roles:
        Array.isArray(existing.roles) && existing.roles.length > 0
          ? existing.roles
          : ['user'],

      permissions: Array.isArray(existing.permissions)
        ? existing.permissions
        : [],

      entitlements: Array.isArray(existing.entitlements)
        ? existing.entitlements
        : [],

      accountStatus: this.resolveAccountStatus(existing),
      authProviders: providerIds,
      lastProvider: 'google.com',
    };
  }

  // ===========================================================================
  // Regras
  // ===========================================================================

  private needsProfileCompletion(user: Partial<SocialAuthUserDoc>): boolean {
    if (typeof user.profileCompleted === 'boolean') {
      return user.profileCompleted !== true;
    }

    return !user.nickname || !(user as Partial<IUserDados>)?.gender;
  }

  private resolveAccountStatus(user: Partial<SocialAuthUserDoc>): AccountStatus {
    const raw = String(user.accountStatus ?? '').trim().toLowerCase();

    if (raw === 'deleted') return 'deleted';
    if (raw === 'suspended') return 'suspended';
    if (raw === 'locked') return 'locked';

    if (user.suspended === true) return 'suspended';
    if (user.accountLocked === true) return 'locked';

    return 'active';
  }

  private normalizeTier(value: unknown): Tier {
    return value === 'free' ||
      value === 'basic' ||
      value === 'premium' ||
      value === 'vip'
      ? value
      : 'basic';
  }

  private normalizeRole(value: unknown): IUserDados['role'] {
    return value === 'visitante' ||
      value === 'free' ||
      value === 'basic' ||
      value === 'premium' ||
      value === 'vip'
      ? value
      : 'basic';
  }

  /**
   * Normaliza photoURL para o boundary do Firestore.
   *
   * Regra:
   * - documento usa string | undefined
   * - null não entra no payload persistido
   */
  private normalizePhotoUrl(value: string | null | undefined): string | undefined {
    const clean = (value ?? '').trim();
    return clean ? clean : undefined;
  }

  private extractProviderIds(authUser: FirebaseUser): string[] {
    const providers = Array.isArray(authUser.providerData)
      ? authUser.providerData
          .map((item) => String(item?.providerId ?? '').trim())
          .filter(Boolean)
      : [];

    return Array.from(new Set(providers.length ? providers : ['google.com']));
  }

  private mergeProviderIds(
    existingProviders: string[] | undefined,
    authUser: FirebaseUser
  ): string[] {
    const merged = [
      ...(Array.isArray(existingProviders) ? existingProviders : []),
      ...this.extractProviderIds(authUser),
      'google.com',
    ].filter(Boolean);

    return Array.from(new Set(merged));
  }

  // ===========================================================================
  // Mapping
  // ===========================================================================

  private mapToUserDados(
    doc: Partial<SocialAuthUserDoc>,
    nowMs: number
  ): IUserDados {
    const tier = this.normalizeTier(doc.tier ?? doc.role ?? 'basic');

    return {
      uid: doc.uid ?? '',
      email: (doc.email ?? '') as any,
      emailVerified: !!doc.emailVerified,

      nickname: ((doc.nickname ?? '') || null) as any,
      photoURL: this.normalizePhotoUrl(doc.photoURL) ?? null,

      role: this.normalizeRole(doc.role ?? tier),
      isSubscriber: !!doc.isSubscriber,

      descricao: (doc as any)?.descricao ?? '',
      socialLinks: (doc as any)?.socialLinks ?? {},

      firstLogin: toEpochOrZero(doc.firstLogin ?? nowMs),
      lastLogin: toEpochOrZero(doc.lastLogin ?? nowMs),

      acceptedTerms: (doc as any)?.acceptedTerms,
      profileCompleted: !!doc.profileCompleted,
      suspended: this.resolveAccountStatus(doc) === 'suspended',
    } as IUserDados;
  }

  // ===========================================================================
  // Resultado estruturado
  // ===========================================================================

  private makeSuccessResult(params: {
    outcome: 'profile-ready' | 'profile-incomplete';
    isNewUser: boolean;
    emailVerified: boolean;
    user: IUserDados;
    nextRoute: SocialAuthNextRoute;
    message?: string;
  }): SocialAuthResult {
    return {
      success: true,
      outcome: params.outcome,
      isNewUser: params.isNewUser,
      emailVerified: params.emailVerified,
      user: params.user,
      nextRoute: params.nextRoute,
      message: params.message,
    };
  }

  private makeBlockedResult(params: {
    reason: SocialAuthBlockReason;
    user: IUserDados | null;
    message: string;
  }): SocialAuthResult {
    return {
      success: false,
      outcome: 'blocked',
      isNewUser: false,
      emailVerified: !!params.user?.emailVerified,
      user: params.user,
      nextRoute: '/login',
      blockedReason: params.reason,
      message: params.message,
      code: `social-auth/${params.reason}`,
    };
  }

  private makeCancelledResult(message = 'Login com Google cancelado.'): SocialAuthResult {
    return {
      success: false,
      outcome: 'cancelled',
      isNewUser: false,
      emailVerified: false,
      user: null,
      nextRoute: null,
      message,
      code: 'social-auth/cancelled',
    };
  }

  private makeErrorResult(params: {
    code?: string;
    message: string;
  }): SocialAuthResult {
    return {
      success: false,
      outcome: 'error',
      isNewUser: false,
      emailVerified: false,
      user: null,
      nextRoute: null,
      code: params.code,
      message: params.message,
    };
  }

  // ===========================================================================
  // Tratamento de erros
  // ===========================================================================

  private handleGoogleLoginError(err: unknown): SocialAuthResult {
    const code = String((err as any)?.code ?? '');

    /**
     * Casos esperados:
     * - usuário fechou popup
     * - popup cancelado por novo popup
     *
     * Isso não precisa ser erro "grave".
     */
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request'
    ) {
      this.reportSilent(err, {
        phase: 'googleLogin.popup',
        code,
        expected: true,
      });

      return this.makeCancelledResult();
    }

    if (code === 'auth/popup-blocked') {
      this.reportSilent(err, {
        phase: 'googleLogin.popup',
        code,
        expected: false,
      });

      return this.makeErrorResult({
        code,
        message: 'O navegador bloqueou o popup do Google. Permita popups e tente novamente.',
      });
    }

    if (code === 'auth/account-exists-with-different-credential') {
      this.reportSilent(err, {
        phase: 'googleLogin.popup',
        code,
        expected: false,
      });

      return this.makeErrorResult({
        code,
        message: 'Já existe uma conta com este e-mail usando outro método de login.',
      });
    }

    this.reportSilent(err, {
      phase: 'googleLogin.popup',
      code,
      expected: false,
    });

    return this.makeErrorResult({
      code: code || 'social-auth/unknown',
      message: 'Não foi possível autenticar com Google agora. Tente novamente.',
    });
  }

  private reportSilent(err: unknown, context: Record<string, unknown>): void {
    try {
      this.dbg('reportSilent', context);

      const error = new Error('[SocialAuthService] operation failed');
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      (error as any).original = err;
      (error as any).context = context;

      this.globalErrorHandler.handleError(error);
    } catch {
      // noop
    }
  }

  // ===========================================================================
  // Debug
  // ===========================================================================

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;

    // eslint-disable-next-line no-console
    console.log(`[SocialAuthService] ${message}`, extra ?? '');
  }
}
