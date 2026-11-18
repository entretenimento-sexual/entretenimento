// src/app/core/services/autentication/register/register.service.ts
// =============================================================================
// RegisterService (rules-aware / best-of-both)
// - Firebase Auth: criação única por tentativa e retomada após falhas parciais
// - Firestore bootstrap: RegistrationBootstrapService
// - Terms acceptance: backend audit through TermsAcceptanceService
// - public_index.rules: createdAt/lastChangedAt MUST be serverTimestamp() => request.time
// - public_profiles.rules: strict allowedKeys + createdAt/updatedAt MUST be serverTimestamp() => request.time
// - No avatar/photoURL at signup
// - Clean debug (traceId) controlled by environment.enableDebugTools
// =============================================================================
import { Injectable } from '@angular/core';
import { defer, from, Observable, of, throwError, timer, TimeoutError } from 'rxjs';
import { catchError, map, retry, switchMap, tap, timeout } from 'rxjs/operators';

import { Auth } from '@angular/fire/auth';

import {
  createUserWithEmailAndPassword,
  UserCredential,
} from 'firebase/auth';

import { ApplicationErrorService } from '../../error-handler/application-error.service';
import { FirestoreValidationService } from '../../data-handling/firestore/validation/firestore-validation.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from './email-verification.service';
import { RegistrationBootstrapService } from './registration-bootstrap.service';
import { TermsAcceptanceService } from '../../compliance/terms-acceptance.service';
import { ValidatorService } from '../../general/validator.service';
import { FirebaseError } from 'firebase/app';
import { environment } from 'src/environments/environment';

import { CacheService } from '../../general/cache/cache.service';
import { NicknameUtils } from '@core/utils/nickname-utils';
import { isTransientNetworkError } from '../../network/network-retry.policy';

export type RegisterUserCredential = UserCredential & {
  verificationEmailSent: boolean;
  registrationWarnings: readonly string[];
};

type SignupContext = {
  cred: UserCredential;
  warns: string[];
  traceId: string;
  verificationEmailSent: boolean;
};

@Injectable({ providedIn: 'root' })
export class RegisterService {
  private readonly NET_TIMEOUT_MS = 12_000;
  private pendingCreation: Promise<UserCredential> | null = null;
  private readonly HOT_KEY_CURRENT_USER_UID = 'currentUserUid';

  // public_profiles.rules (nicknameNormalized):
  private readonly NICKNAME_NORM_RE = /^[a-z0-9._-]{3,40}$/;

  constructor(
    private readonly emailVerificationService: EmailVerificationService,
    private readonly registrationBootstrap: RegistrationBootstrapService,
    private readonly termsAcceptance: TermsAcceptanceService,
    private readonly applicationError: ApplicationErrorService,
    private readonly firestoreValidation: FirestoreValidationService,
    private readonly cache: CacheService,
    private readonly auth: Auth
  ) { }

  registerUser(
    userData: IUserRegistrationData,
    password: string
  ): Observable<RegisterUserCredential> {
    const traceId = this.makeTraceId();

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return this.handleRegisterError(
        new Error('Sem conexão com a internet. Verifique e tente novamente.'),
        'Rede',
        traceId
      );
    }

    this.devDebug(traceId, 'registerUser:start', {
      email: this.safeEmail(userData?.email),
      nicknameLen: (userData?.nickname ?? '').trim().length,
      acceptedTerms: !!userData?.acceptedTerms?.accepted,
    });

    return defer(() => {
      this.assertCanCreateCredential();
      return this.validateUserData(userData, traceId);
    }).pipe(
      switchMap(() => this.createCredential$(userData.email, password)),
      switchMap((cred) => {
        this.assertActiveCredential(cred);
        this.termsAcceptance.rememberPendingSignupAcceptance(cred.user.uid);
        const context: SignupContext = { cred, warns: [], traceId, verificationEmailSent: false };
        return defer(() => {
          this.assertActiveCredential(cred);
          return this.registrationBootstrap.createEmailPasswordSeed$({
            uid: cred.user.uid,
            userData,
            traceId,
          });
        }).pipe(
          timeout({ first: this.NET_TIMEOUT_MS }),
          // A reserva é idempotente para o mesmo UID e o mesmo apelido.
          retry({
            count: 1,
            delay: (error: unknown) => error instanceof TimeoutError || isTransientNetworkError(error)
              ? timer(500)
              : throwError(() => error),
          }),
          map(() => context),
          catchError((error: unknown) => {
            this.assertActiveCredential(cred);
            this.safeHandle('Não foi possível confirmar a reserva do apelido.', error, {
              operation: 'reserveRegistrationNickname',
              traceId,
            });
            context.warns.push('nickname-reservation-unconfirmed');
            return of(context);
          })
        );
      }),

      /**
       * O backend registra termos e evidência da declaração explícita no
       * mesmo passo. A autorização etária só é avaliada após verificar o e-mail.
       * Em caso de falha, o cadastro retoma a partir do que foi confirmado.
       */
      switchMap((ctx2) =>
        defer(() => {
          this.assertActiveCredential(ctx2.cred);
          return this.termsAcceptance.acceptForUser$(ctx2.cred.user.uid, {
            signupAdultDeclaration: userData.confirmsAdult === true,
          });
        }).pipe(
          timeout({ first: this.NET_TIMEOUT_MS }),
          retry({
            count: 1,
            delay: (error: unknown) => {
              const failure = error as { details?: { reason?: unknown } } | null;
              return failure?.details?.reason === 'registration/seed-pending' ||
                ((typeof navigator === 'undefined' || navigator.onLine) &&
                  (error instanceof TimeoutError || isTransientNetworkError(error)))
                ? timer(500)
                : throwError(() => error);
            },
          }),
          tap((result) => {
            if (result.signupAdultDeclarationRecorded !== true) {
              ctx2.warns.push('adult-declaration-unconfirmed');
            }
            this.devDebug(ctx2.traceId, 'compliance:terms:ok', {
              uid: ctx2.cred.user.uid,
            });
          }),
          map(() => ctx2),
          catchError((err) => {
            this.safeHandle(
              '[RegisterService] Falha ao registrar aceite auditável dos termos (warn).',
              err,
              {
                operation: 'acceptTermsAudit',
                traceId: ctx2.traceId,
                uid: ctx2.cred.user.uid,
              }
            );
            ctx2.warns.push('terms-acceptance-audit-failed');
            ctx2.warns.push('adult-declaration-unconfirmed');
            return of(ctx2);
          })
        )
      ),

      switchMap((ctx2) =>
        defer(() => {
          this.assertActiveCredential(ctx2.cred);
          return this.emailVerificationService.sendEmailVerification(ctx2.cred.user);
        }).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          tap(() => {
            ctx2.verificationEmailSent = true;
            this.devDebug(ctx2.traceId, 'verification-email:sent', {
              uid: ctx2.cred.user.uid,
            });
          }),
          catchError((err) => {
            this.safeHandle('[RegisterService] Falha ao enviar e-mail de verificação (warn).', err, {
              operation: 'sendVerificationEmail',
              traceId: ctx2.traceId,
              uid: ctx2.cred.user.uid,
            });
            ctx2.verificationEmailSent = false;
            ctx2.warns.push('email-verification-failed');
            return of(void 0);
          }),
          map(() => ctx2)
        )
      ),

      tap((ctx2) => {
        this.assertActiveCredential(ctx2.cred);
        const { user } = ctx2.cred;

        this.seedLocalStateAfterSignup(user.uid);

        if (!environment.production && ctx2.warns.length) {
          this.devWarn(ctx2.traceId, 'registerUser:warns', { warns: ctx2.warns });
        }

        this.devDebug(ctx2.traceId, 'registerUser:done', {
          uid: user.uid,
          verificationEmailSent: ctx2.verificationEmailSent,
        });
      }),

      map((ctx2): RegisterUserCredential => ({
        ...ctx2.cred,
        verificationEmailSent: ctx2.verificationEmailSent,
        registrationWarnings: [...ctx2.warns],
      })),

      catchError((err) => this.handleRegisterError(err, 'Registro', traceId))
    );
  }

  private createCredential$(email: string, password: string): Observable<UserCredential> {
    return defer(() => {
      this.assertCanCreateCredential();
      const creation = this.createFirebaseUser(email.trim(), password);
      this.pendingCreation = creation;
      const release = () => {
        if (this.pendingCreation === creation) this.pendingCreation = null;
      };
      void creation.then(release, release);

      return from(creation).pipe(
        timeout({ first: this.NET_TIMEOUT_MS }),
        catchError((error: unknown) => {
          if (error instanceof TimeoutError || isTransientNetworkError(error)) {
            return throwError(() => this.creationUnconfirmedError(error));
          }
          return throwError(() => error);
        })
      );
    });
  }

  private createFirebaseUser(email: string, password: string): Promise<UserCredential> {
    return createUserWithEmailAndPassword(this.auth, email, password);
  }

  private assertCanCreateCredential(): void {
    if (this.pendingCreation) throw this.creationUnconfirmedError();
    if (this.auth.currentUser) {
      throw Object.assign(new Error('Já existe uma sessão aberta. Continue pela sua conta.'), {
        code: 'registration-session-active',
      });
    }
  }

  private creationUnconfirmedError(cause?: unknown): Error {
    return Object.assign(new Error(
      'Não conseguimos confirmar a criação da conta. Tente entrar com os dados informados ou recuperar o acesso.',
      { cause }
    ), { code: 'registration-creation-unconfirmed' });
  }

  private assertActiveCredential(credential: UserCredential): void {
    if (this.auth.currentUser !== credential.user) {
      throw Object.assign(new Error('A conta foi criada. Entre com o e-mail usado no cadastro para continuar.'), {
        code: 'registration-account-created',
      });
    }
  }

  private validateUserData(user: IUserRegistrationData, traceId: string): Observable<void> {
    const nickname = (user.nickname ?? '').trim();
    const email = (user.email ?? '').trim();

    if (!user?.acceptedTerms?.accepted) {
      return this.handleRegisterError(
        new Error('Você precisa aceitar os Termos de Uso para continuar.'),
        'Validação',
        traceId
      );
    }

    // Segurança pré-Auth: nenhuma identidade deve nascer neste fluxo sem
    // declaração explícita 18+. Não confundir com confirmação canônica.
    if (user?.confirmsAdult !== true) {
      return this.handleRegisterError(
        new Error('Esta plataforma é exclusiva para maiores de 18 anos. Confirme sua maioridade para criar a conta.'),
        'Validação',
        traceId
      );
    }

    if (nickname.length < 4 || nickname.length > 24) {
      return this.handleRegisterError(
        new Error('Apelido deve ter entre 4 e 24 caracteres.'),
        'Validação',
        traceId
      );
    }

    if (!this.isValidEmailFormat(email)) {
      return this.handleRegisterError(
        new Error('Formato de e-mail inválido.'),
        'Validação',
        traceId
      );
    }

    const normalized = this.normalizeNickname(nickname);
    if (!this.NICKNAME_NORM_RE.test(normalized)) {
      return this.handleRegisterError(
        new Error(
          'Apelido inválido. Use letras/números e separadores (. _ -). ' +
          'Espaços são permitidos no apelido, e serão convertidos internamente para "_" no índice.'
        ),
        'Validação',
        traceId
      );
    }

    return this.firestoreValidation.checkIfNicknameExists(nickname, { mode: 'strict' }).pipe(
      timeout({ first: this.NET_TIMEOUT_MS }),
      catchError((cause: unknown) => this.handleRegisterError(Object.assign(
        new Error('Não foi possível validar o apelido agora.', { cause }), { code: 'nickname-check-failed' }
      ), 'Validação', traceId)),
      switchMap((exists) => {
        if (exists) {
          return this.handleRegisterError(
            new Error('Apelido já está em uso.'),
            'Validação',
            traceId
          );
        }

        return of(void 0);
      })
    );
  }

  isValidEmailFormat(email: string): boolean {
    return ValidatorService.isValidEmail(email);
  }

  private seedLocalStateAfterSignup(uid: string): void {
    const safeUid = (uid ?? '').trim();
    if (!safeUid || this.auth.currentUser?.uid !== safeUid) return;

    this.cache.set(this.HOT_KEY_CURRENT_USER_UID, safeUid, undefined, { persist: false });
  }

  private handleRegisterError(
    error: any,
    context: string,
    traceId: string
  ): Observable<never> {
    if ((error as { registerApplicationErrorReported?: unknown } | null)
      ?.registerApplicationErrorReported === true) {
      return throwError(() => error);
    }

    const message = this.mapErrorMessage(error);
    this.safeHandle(`[RegisterService] ${context}`, error, {
      operation: 'handleRegisterError',
      context,
      traceId,
      mappedMessage: message,
    });

    const userErr: any = new Error(message);
    const originalCode = String((error as any)?.code ?? '');

    /**
     * Compatibilidade com a UI existente, sem expor detalhes adicionais.
     * A recuperação só é iniciada quando o próprio usuário escolher essa ação.
     */
    userErr.code = originalCode === 'auth/email-already-in-use'
      ? 'email-exists-soft'
      : originalCode || undefined;
    userErr.registerApplicationErrorReported = true;

    return throwError(() => userErr);
  }

  private mapErrorMessage(error: any): string {
    if ((error as any)?.code === 'email-exists-soft') {
      return (error as any).message ??
        'Não foi possível criar uma nova conta com este e-mail. Tente entrar ou recuperar a senha.';
    }

    if (error instanceof FirebaseError) {
      switch (error.code) {
        case 'auth/email-already-in-use':
          return 'Não foi possível criar uma nova conta com este e-mail. Tente entrar ou recuperar a senha.';
        case 'auth/weak-password':
          return 'Senha fraca. Ela precisa ter pelo menos 8 caracteres.';
        case 'auth/invalid-email':
          return 'Formato de e-mail inválido.';
        case 'auth/network-request-failed':
          return 'Problema de conexão. Verifique sua internet.';
        case 'permission-denied':
          return 'Permissão negada ao salvar seus dados. Tente novamente.';
        case 'deadline-exceeded':
          return 'Tempo de resposta excedido. Tente novamente.';
        default:
          return `Erro no registro (${error.code}).`;
      }
    }

    if (error instanceof TimeoutError) return 'Conexão lenta. Tente novamente em instantes.';
    if (error instanceof Error) return error.message;
    return 'Erro inesperado no processo de registro.';
  }

  private safeHandle(
    msg: string,
    original: unknown,
    meta?: Record<string, unknown>
  ): void {
    try {
      if (this.registrationBootstrap.hasDiagnosticOwnership(original) ||
          this.registrationBootstrap.hasDiagnosticOwnership((original as Error | null)?.cause)) {
        return;
      }

      if (!environment.production && environment.enableDebugTools) {
        console.error(msg, { original, meta });
      }

      const operation =
        typeof meta?.['operation'] === 'string' && meta['operation'].trim()
          ? meta['operation'].trim()
          : 'internal';

      this.applicationError.report(original, {
        feature: 'register',
        operation,
        fallbackMessage: msg,
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'RegisterService',
          ...(meta ?? {}),
        },
      });
    } catch {
      // Diagnóstico secundário não interfere no cadastro.
    }
  }

  private normalizeNickname(nickname: string): string {
    return NicknameUtils.normalizarApelidoParaIndice(nickname);
  }

  private makeTraceId(): string {
    const r = Math.random().toString(16).slice(2, 8);
    return `rg_${Date.now().toString(16)}_${r}`;
  }

  private debugEnabled(): boolean {
    return !environment.production && !!environment.enableDebugTools;
  }

  private devDebug(traceId: string, tag: string, data?: Record<string, unknown>): void {
    if (!this.debugEnabled()) return;
    try { console.debug(`[RegisterService][${traceId}] ${tag}`, data ?? {}); } catch { }
  }

  private devWarn(traceId: string, tag: string, data?: Record<string, unknown>): void {
    if (!this.debugEnabled()) return;
    try { console.warn(`[RegisterService][${traceId}] ${tag}`, data ?? {}); } catch { }
  }

  private safeEmail(email: string | undefined | null): string {
    const e = (email ?? '').trim();
    if (!e) return '';
    const [u, d] = e.split('@');
    if (!u || !d) return e;
    return `${u.slice(0, 2)}***@${d}`;
  }
}
