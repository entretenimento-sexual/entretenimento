// src/app/core/services/autentication/register/register.service.ts
// =============================================================================
// RegisterService (rules-aware / best-of-both)
// - Auth propagation: refresh token + onIdTokenChanged
// - Firestore bootstrap: RegistrationBootstrapService
// - Terms acceptance: backend audit through TermsAcceptanceService
// - public_index.rules: createdAt/lastChangedAt MUST be serverTimestamp() => request.time
// - public_profiles.rules: strict allowedKeys + createdAt/updatedAt MUST be serverTimestamp() => request.time
// - No avatar/photoURL at signup
// - Clean debug (traceId) controlled by environment.enableDebugTools
// =============================================================================
import { Injectable } from '@angular/core';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap, timeout, take } from 'rxjs/operators';

import { Auth } from '@angular/fire/auth';

import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  sendPasswordResetEmail,
  updateProfile,
  onIdTokenChanged,
  UserCredential,
  type User,
} from 'firebase/auth';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
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

type SignupContext = {
  cred: UserCredential;
  warns: string[];
  traceId: string;
};

@Injectable({ providedIn: 'root' })
export class RegisterService {
  private readonly NET_TIMEOUT_MS = 12_000;
  private readonly HOT_KEY_CURRENT_USER_UID = 'currentUserUid';

  // public_profiles.rules (nicknameNormalized):
  private readonly NICKNAME_NORM_RE = /^[a-z0-9._-]{3,40}$/;

  constructor(
    private readonly emailVerificationService: EmailVerificationService,
    private readonly registrationBootstrap: RegistrationBootstrapService,
    private readonly termsAcceptance: TermsAcceptanceService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly firestoreValidation: FirestoreValidationService,
    private readonly cache: CacheService,
    private readonly auth: Auth
  ) { }

  registerUser(userData: IUserRegistrationData, password: string): Observable<UserCredential> {
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

    return this.validateUserData(userData, traceId).pipe(
      switchMap(() =>
        from(createUserWithEmailAndPassword(this.auth, userData.email, password)).pipe(
          timeout({ each: this.NET_TIMEOUT_MS })
        )
      ),

      switchMap((cred) =>
        this.waitAuthPropagationForFirestore$(cred.user.uid, traceId).pipe(map(() => cred))
      ),

      switchMap((cred) =>
        this.registrationBootstrap
          .createEmailPasswordSeed$({
            uid: cred.user.uid,
            userData,
            traceId,
          })
          .pipe(
            tap(() => this.devDebug(traceId, 'persist:bootstrap:ok', { uid: cred.user.uid })),
            map((): SignupContext => ({ cred, warns: [], traceId })),
            catchError((err) =>
              this.deleteUserOnFailure(cred.user.uid).pipe(
                catchError((delErr) => {
                  this.safeHandle(
                    '[RegisterService] Falha ao rollback do Auth após erro no Firestore.',
                    delErr,
                    {
                      traceId,
                      uid: cred.user.uid,
                    }
                  );
                  return of(void 0);
                }),
                switchMap(() => throwError(() => err))
              )
            )
          )
      ),

      /**
       * O checkbox de cadastro é validado antes da criação da conta, mas o
       * registro definitivo dos termos pertence ao backend. A Cloud Function
       * grava versão, horário do servidor e compliance_audit.
       *
       * Se a auditoria estiver temporariamente indisponível, o cadastro segue
       * com acceptedTerms=false. O RegisterFlowFacade encaminhará o usuário para
       * /register/aceitar-termos após a verificação de e-mail.
       */
      switchMap((ctx2) =>
        this.termsAcceptance.acceptForUser$(ctx2.cred.user.uid).pipe(
          tap(() =>
            this.devDebug(ctx2.traceId, 'compliance:terms:ok', {
              uid: ctx2.cred.user.uid,
            })
          ),
          map(() => ctx2),
          catchError((err) => {
            this.safeHandle(
              '[RegisterService] Falha ao registrar aceite auditável dos termos (warn).',
              err,
              {
                traceId: ctx2.traceId,
                uid: ctx2.cred.user.uid,
              }
            );
            ctx2.warns.push('terms-acceptance-audit-failed');
            return of(ctx2);
          })
        )
      ),

      switchMap((ctx2) =>
        this.emailVerificationService.sendEmailVerification(ctx2.cred.user).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          catchError((err) => {
            this.safeHandle('[RegisterService] Falha ao enviar e-mail de verificação (warn).', err, {
              traceId: ctx2.traceId,
              uid: ctx2.cred.user.uid,
            });
            ctx2.warns.push('email-verification-failed');
            return of(void 0);
          }),
          map(() => ctx2)
        )
      ),

      switchMap((ctx2) =>
        from(updateProfile(ctx2.cred.user, { displayName: (userData.nickname ?? '').trim() })).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          catchError((err) => {
            this.safeHandle('[RegisterService] Falha no updateProfile (warn).', err, {
              traceId: ctx2.traceId,
              uid: ctx2.cred.user.uid,
            });
            ctx2.warns.push('update-profile-failed');
            return of(void 0);
          }),
          map(() => ctx2)
        )
      ),

      tap((ctx2) => {
        const { user } = ctx2.cred;

        this.seedLocalStateAfterSignup(user.uid);

        if (!environment.production && ctx2.warns.length) {
          this.devWarn(ctx2.traceId, 'registerUser:warns', { warns: ctx2.warns });
        }

        this.devDebug(ctx2.traceId, 'registerUser:done', { uid: user.uid });
      }),

      map((ctx2) => ctx2.cred),

      catchError((err) => this.handleRegisterError(err, 'Registro', traceId))
    );
  }

  private waitAuthPropagationForFirestore$(expectedUid: string, traceId: string): Observable<void> {
    const refresh$ = from(
      this.auth.currentUser?.getIdToken(true) ?? Promise.resolve('')
    ).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      catchError((err) => {
        this.safeHandle('[RegisterService] getIdToken(true) falhou (warn).', err, {
          traceId,
          expectedUid,
        });
        return of('');
      })
    );

    const tokenChanged$ = new Observable<void>((subscriber) => {
      const unsub = onIdTokenChanged(
        this.auth,
        (user: User | null) => {
          if (user?.uid === expectedUid) {
            subscriber.next();
            subscriber.complete();
          }
        },
        (err: unknown) => subscriber.error(err)
      );

      return () => unsub();
    }).pipe(
      take(1),
      timeout({ each: this.NET_TIMEOUT_MS })
    );

    return refresh$.pipe(
      switchMap(() => tokenChanged$),
      map(() => void 0),
      catchError((err) =>
        this.handleRegisterError(err, 'Sincronização Auth/Firestore', traceId)
      )
    );
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

    return this.firestoreValidation.checkIfNicknameExists(nickname).pipe(
      switchMap((exists) => {
        if (exists) {
          return this.handleRegisterError(
            new Error('Apelido já está em uso.'),
            'Validação',
            traceId
          );
        }
        return this.checkIfEmailExists(email, traceId);
      })
    );
  }

  isValidEmailFormat(email: string): boolean {
    return ValidatorService.isValidEmail(email);
  }

  private checkIfEmailExists(email: string, traceId: string): Observable<void> {
    return from(fetchSignInMethodsForEmail(this.auth, email)).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      switchMap((methods) => {
        if (!methods || methods.length === 0) return of(void 0);

        return from(sendPasswordResetEmail(this.auth, email)).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          switchMap(() =>
            throwError(() => ({
              code: 'email-exists-soft',
              message: 'Se existir uma conta com este e-mail, você receberá instruções para recuperar o acesso.',
            }))
          )
        );
      }),
      catchError((err) => {
        if ((err as FirebaseError)?.code === 'auth/network-request-failed') {
          return this.handleRegisterError(
            new Error('Conexão instável ao verificar e-mail. Tente novamente.'),
            'Verificação de e-mail',
            traceId
          );
        }
        return throwError(() => err);
      })
    );
  }

  deleteUserOnFailure(uid: string): Observable<void> {
    const currentUser = this.auth.currentUser;
    if (currentUser?.uid === uid) {
      return from(currentUser.delete()).pipe(
        catchError((error) => {
          this.safeHandle('[RegisterService] Falha ao deletar usuário no rollback.', error, { uid });
          return throwError(() => new Error('Erro ao deletar usuário.'));
        })
      );
    }
    return of(void 0);
  }

  private seedLocalStateAfterSignup(uid: string): void {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return;

    this.cache.set(this.HOT_KEY_CURRENT_USER_UID, safeUid, undefined, { persist: false });
  }

  private handleRegisterError(error: any, context: string, traceId: string): Observable<never> {
    const message = this.mapErrorMessage(error);
    this.safeHandle(`[RegisterService] ${context}`, error, { traceId, mappedMessage: message });

    const userErr: any = new Error(message);
    if (error && (error as any).code) userErr.code = (error as any).code;
    return throwError(() => userErr);
  }

  private mapErrorMessage(error: any): string {
    if ((error as any)?.code === 'email-exists-soft') {
      return (error as any).message ?? 'Se existir uma conta com este e-mail, você receberá instruções para recuperar o acesso.';
    }

    if (error instanceof FirebaseError) {
      switch (error.code) {
        case 'auth/email-already-in-use':
          return 'Se existir uma conta com este e-mail, você receberá instruções para recuperar o acesso.';
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

    if (error?.name === 'TimeoutError') return 'Conexão lenta. Tente novamente em instantes.';
    if (error instanceof Error) return error.message;
    return 'Erro inesperado no processo de registro.';
  }

  private safeHandle(msg: string, original: unknown, meta?: Record<string, unknown>): void {
    try {
      const e = new Error(msg);
      (e as any).original = original;
      (e as any).meta = meta;
      (e as any).skipUserNotification = true;

      if (!environment.production && environment.enableDebugTools) {
        console.error(msg, { original, meta });
      }

      this.globalErrorHandler.handleError(e);
    } catch { }
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
