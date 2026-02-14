// src/app/core/services/autentication/register/register.service.ts
// =============================================================================
// RegisterService (rules-aware / best-of-both)
// - Auth propagation: refresh token + onIdTokenChanged
// - Firestore writes: transaction (users + public_index + public_profiles)
// - public_index.rules: createdAt/lastChangedAt MUST be serverTimestamp() => request.time
// - public_profiles.rules: strict allowedKeys + createdAt/updatedAt MUST be serverTimestamp() => request.time
// - No avatar/photoURL at signup
// - Clean debug (traceId) controlled by environment.enableDebugTools
// =============================================================================

import { Injectable } from '@angular/core';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap, timeout, take } from 'rxjs/operators';

import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';

import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  sendPasswordResetEmail,
  updateProfile,
  onIdTokenChanged,
  UserCredential,
  type User,
} from 'firebase/auth';

import {
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  getDoc,
  setDoc,
} from 'firebase/firestore';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreValidationService } from '../../data-handling/firestore/validation/firestore-validation.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from './email-verification.service';
import { ValidatorService } from '../../general/validator.service';
import { FirebaseError } from 'firebase/app';
import { environment } from 'src/environments/environment';

import { CurrentUserStoreService } from '../auth/current-user-store.service';
import { CacheService } from '../../general/cache/cache.service';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { NicknameUtils } from '@core/utils/nickname-utils';

type SignupContext = {
  cred: UserCredential;
  warns: string[];
  traceId: string;
};

@Injectable({ providedIn: 'root' })
export class RegisterService {
  private readonly NET_TIMEOUT_MS = 12_000;

  // public_profiles.rules (nicknameNormalized):
  private readonly NICKNAME_NORM_RE = /^[a-z0-9._-]{3,40}$/;

  constructor(
    private readonly emailVerificationService: EmailVerificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly firestoreValidation: FirestoreValidationService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly cache: CacheService,
    private readonly auth: Auth,
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService
  ) { }

  registerUser(userData: IUserRegistrationData, password: string): Observable<UserCredential> {
    const traceId = this.makeTraceId();

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return this.handleRegisterError(new Error('Sem conexão com a internet. Verifique e tente novamente.'), 'Rede', traceId);
    }

    this.devDebug(traceId, 'registerUser:start', {
      email: this.safeEmail(userData?.email),
      nicknameLen: (userData?.nickname ?? '').trim().length,
      acceptedTerms: !!userData?.acceptedTerms?.accepted,
    });

    return this.validateUserData(userData, traceId).pipe(
      // 1) cria conta no Auth
      switchMap(() =>
        from(createUserWithEmailAndPassword(this.auth, userData.email, password)).pipe(
          timeout({ each: this.NET_TIMEOUT_MS })
        )
      ),

      // 2) garante token/propagação antes de escrever no Firestore (rules dependem disso)
      switchMap((cred) =>
        this.waitAuthPropagationForFirestore$(cred.user.uid, traceId).pipe(map(() => cred))
      ),

      // 3) transação atômica: users + public_index + public_profiles
      switchMap((cred) =>
        this.persistUserAndIndexAtomic(cred.user.uid, userData, traceId).pipe(
          map((): SignupContext => ({ cred, warns: [], traceId })),
          // rollback best-effort se Firestore falhar
          catchError((err) =>
            this.deleteUserOnFailure(cred.user.uid).pipe(
              catchError((delErr) => {
                this.safeHandle('[RegisterService] Falha ao rollback do Auth após erro no Firestore.', delErr, {
                  traceId,
                  uid: cred.user.uid,
                });
                return of(void 0);
              }),
              switchMap(() => throwError(() => err))
            )
          )
        )
      ),

      // 4) e-mail de verificação (warn se falhar)
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

      // 5) updateProfile: SOMENTE displayName (não força photoURL)
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

      // 6) seed local state
      tap((ctx2) => {
        const { user } = ctx2.cred;
        const now = Date.now();

        this.seedLocalStateAfterSignup(user.uid, {
          uid: user.uid,
          email: user.email || '',
          nickname: (userData.nickname ?? '').trim(),
          role: 'basic',
          emailVerified: false,
          isSubscriber: false,
          profileCompleted: false,
          registrationDate: now,
          firstLogin: now,
          acceptedTerms: { accepted: true, date: now },
        });

        if (!environment.production && ctx2.warns.length) {
          this.devWarn(ctx2.traceId, 'registerUser:warns', { warns: ctx2.warns });
        }

        this.devDebug(ctx2.traceId, 'registerUser:done', { uid: user.uid });
      }),

      map((ctx2) => ctx2.cred),

      catchError((err) => this.handleRegisterError(err, 'Registro', traceId))
    );
  }

  /**
   * waitAuthPropagationForFirestore$
   * - Força refresh do token (quando possível)
   * - Aguarda onIdTokenChanged entregar o UID esperado
   * - timeout + take(1) para não deixar listener vivo
   */
  private waitAuthPropagationForFirestore$(expectedUid: string, traceId: string): Observable<void> {
    if (this.auth.currentUser?.uid === expectedUid) return of(void 0);

    const refresh$ = from(this.auth.currentUser?.getIdToken(true) ?? Promise.resolve('')).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      catchError((err) => {
        // não bloqueia o fluxo: ainda tentamos aguardar o evento
        this.safeHandle('[RegisterService] getIdToken(true) falhou (warn).', err, { traceId, expectedUid });
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
    }).pipe(take(1));

    return refresh$.pipe(
      switchMap(() => tokenChanged$),
      timeout({ each: this.NET_TIMEOUT_MS }),
      map(() => void 0),
      catchError((err) => this.handleRegisterError(err, 'Sincronização Auth/Firestore', traceId))
    );
  }

  private validateUserData(user: IUserRegistrationData, traceId: string): Observable<void> {
    const nickname = (user.nickname ?? '').trim();
    const email = (user.email ?? '').trim();

    if (!user?.acceptedTerms?.accepted) {
      return this.handleRegisterError(new Error('Você precisa aceitar os Termos de Uso para continuar.'), 'Validação', traceId);
    }

    if (nickname.length < 4 || nickname.length > 24) {
      return this.handleRegisterError(new Error('Apelido deve ter entre 4 e 24 caracteres.'), 'Validação', traceId);
    }

    if (!this.isValidEmailFormat(email)) {
      return this.handleRegisterError(new Error('Formato de e-mail inválido.'), 'Validação', traceId);
    }

    // garante compat com public_profiles.rules (nicknameNormalized regex)
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
        if (exists) return this.handleRegisterError(new Error('Apelido já está em uso.'), 'Validação', traceId);
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

  /**
   * persistUserAndIndexAtomic
   * - users.rules: allow create if isSelf(userId)
   * - public_index.rules: createdAt/lastChangedAt == request.time (serverTimestamp obrigatório)
   * - public_profiles.rules: allowedKeys rígida + createdAt/updatedAt == request.time + role=="basic"
   */
  private persistUserAndIndexAtomic(uid: string, userData: IUserRegistrationData, traceId: string): Observable<void> {
    const nickname = (userData.nickname ?? '').trim();
    const normalized = this.normalizeNickname(nickname);
    const nowMs = Date.now();

    const userRef = doc(this.db as any, 'users', uid);
    const indexRef = doc(this.db as any, 'public_index', `nickname:${normalized}`);
    const publicProfileRef = doc(this.db as any, 'public_profiles', uid);

    this.devDebug(traceId, 'persist:tx:start', {
      uid,
      indexDocId: `nickname:${normalized}`,
      authUid: this.auth.currentUser?.uid ?? null,
    });

    return this.ctx.deferPromise$(() =>
      runTransaction(this.db as any, async (tx) => {
        // 1) unicidade via public_index
        const idxSnap = await tx.get(indexRef);
        if (idxSnap.exists()) {
          const err: any = new Error('Apelido já está em uso.');
          err.code = 'nickname/in-use';
          throw err;
        }

        // 2) users/{uid}
        // Obs.: users.rules não tem whitelist por enquanto.
        // Aqui você já “trava” alguns campos sensíveis (role/isSubscriber) no create, o que é esperado.
        tx.set(userRef, {
          uid,
          email: (userData.email ?? '').trim(),
          nickname,
          role: 'basic',
          emailVerified: false,
          isSubscriber: false,
          profileCompleted: false,

          acceptedTerms: {
            accepted: true,
            date: serverTimestamp(),
          },

          // timestamps do sistema (mais auditável)
          createdAt: serverTimestamp(),
          registrationDate: serverTimestamp(),
          firstLogin: serverTimestamp(),

          nicknameHistory: [
            { nickname: normalized, date: Timestamp.fromMillis(nowMs) },
          ],
        }, { merge: true });

        // 3) public_index/nickname:...
        // ✅ RULES: createdAt/lastChangedAt MUST be serverTimestamp() => request.time
        tx.set(indexRef, {
          uid,
          type: 'nickname',
          value: normalized,
          createdAt: serverTimestamp(),
          lastChangedAt: serverTimestamp(),
        });

        // 4) public_profiles/{uid}
        // ✅ RULES: allowedKeys() estrita + createdAt/updatedAt MUST be serverTimestamp() + role basic
        tx.set(publicProfileRef, {
          uid,
          nickname,
          nicknameNormalized: normalized,
          role: 'basic',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          // avatarUrl/photoURL ausentes nesta fase (ok: null/ausente passa nas rules)
        });
      })
    ).pipe(
      map(() => void 0),
      tap(() => this.devDebug(traceId, 'persist:tx:ok', { uid })),
        catchError((err: any) => {
          const fb = {
            name: err?.name,
            code: err?.code,
            message: err?.message,
            customData: err?.customData,
          };

          this.safeHandle('[RegisterService] persistUserAndIndexAtomic falhou.', err, {
            traceId,
            uid,
            nickname,
            normalized,
            authUid: this.auth.currentUser?.uid ?? null,
            firebaseError: fb,
          });

          return throwError(() => err);
        })
    );
  }

  /**
   * (Opcional / DEV) Debug de permissão: tenta 3 writes sequenciais (não atômico)
   * Use apenas para descobrir QUAL coleção está negando (users / public_index / public_profiles).
   */
  private debugPersistWrites$(uid: string, userData: IUserRegistrationData, traceId: string): Observable<void> {
    if (!this.debugEnabled()) return throwError(() => new Error('Debug tools desabilitadas.'));

    const nickname = (userData.nickname ?? '').trim();
    const normalized = this.normalizeNickname(nickname);

    const userRef = doc(this.db as any, 'users', uid);
    const indexRef = doc(this.db as any, 'public_index', `nickname:${normalized}`);
    const publicProfileRef = doc(this.db as any, 'public_profiles', uid);

    this.devWarn(traceId, 'debugPersistWrites$:ON', { uid, indexDocId: `nickname:${normalized}` });

    return this.ctx.deferPromise$(() =>
      setDoc(userRef as any, {
        uid,
        email: (userData.email ?? '').trim(),
        nickname,
        role: 'basic',
        createdAt: serverTimestamp(),
      }, { merge: true })
    ).pipe(
      tap(() => this.devDebug(traceId, 'debugPersistWrites$:OK users')),

      switchMap(() => this.ctx.deferPromise$(() => getDoc(indexRef))),
      switchMap((snap) => {
        if (snap.exists()) {
          const err: any = new Error('Apelido já está em uso.');
          err.code = 'nickname/in-use';
          return throwError(() => err);
        }
        return this.ctx.deferPromise$(() =>
          setDoc(indexRef, {
            uid,
            type: 'nickname',
            value: normalized,
            createdAt: serverTimestamp(),
            lastChangedAt: serverTimestamp(),
          })
        );
      }),
      tap(() => this.devDebug(traceId, 'debugPersistWrites$:OK public_index')),

      switchMap(() =>
        this.ctx.deferPromise$(() =>
          setDoc(publicProfileRef, {
            uid,
            nickname,
            nicknameNormalized: normalized,
            role: 'basic',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        )
      ),
      tap(() => this.devDebug(traceId, 'debugPersistWrites$:OK public_profiles')),

      map(() => void 0)
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

  private seedLocalStateAfterSignup(uid: string, data: Partial<IUserRegistrationData>): void {
    const now = Date.now();

    const snapshot: Partial<IUserRegistrationData> = {
      uid,
      email: data.email || '',
      nickname: data.nickname || '',
      role: data.role ?? 'basic',
      emailVerified: !!data.emailVerified,
      isSubscriber: !!data.isSubscriber,
      profileCompleted: !!data.profileCompleted,
      firstLogin: typeof data.firstLogin === 'number' ? data.firstLogin : now,
      registrationDate: typeof data.registrationDate === 'number' ? data.registrationDate : now,
      acceptedTerms: {
        accepted: !!data.acceptedTerms?.accepted,
        date: data.acceptedTerms?.date ?? now,
      },
    };

    this.currentUserStore.set(snapshot as any);
    this.cache.syncCurrentUserWithUid(snapshot as any);
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
        // segurança: não expõe existência
        case 'auth/email-already-in-use':
          return 'Se existir uma conta com este e-mail, você receberá instruções para recuperar o acesso.';
        case 'auth/weak-password':
          return 'Senha fraca. Ela precisa ter pelo menos 6 caracteres.';
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

  // ----------------------------------------------------------------------------
  // Helpers / Debug
  // ----------------------------------------------------------------------------
  private normalizeNickname(nickname: string): string {
    /**
  * Centralização:
  * - DISPLAY pode conter espaço (ex.: "João Oficial")
  * - Índice (public_index docId / nicknameNormalized) NÃO pode conter espaço
  * - Portanto, convertemos espaços para "_" e removemos diacríticos para gerar a KEY.
  *
  * Isso evita divergência entre:
  * - validação do register
  * - checagem de unicidade em public_index
  * - persistência em transaction
  */
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
