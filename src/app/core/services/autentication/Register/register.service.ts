// src/app/core/services/autentication/register/register.service.ts
// Não esqueça os comentários
import { Injectable } from '@angular/core';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, map, tap, timeout, take } from 'rxjs/operators';

import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { doc, runTransaction, writeBatch, Timestamp } from 'firebase/firestore';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreValidationService } from '../../data-handling/firestore/validation/firestore-validation.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from './email-verification.service';
import { ValidatorService } from '../../general/validator.service';
import { FirebaseError } from 'firebase/app';
import { environment } from 'src/environments/environment';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile,
  UserCredential,  fetchSignInMethodsForEmail,  onIdTokenChanged,
  type User // User está esmaecido
} from 'firebase/auth';

import { userConverter } from '../../data-handling/converters/user.firestore-converter';
import { CurrentUserStoreService } from '../auth/current-user-store.service';
import { CacheService } from '../../general/cache/cache.service';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

type SignupContext = {
  cred: UserCredential;
  warns: string[];
};

@Injectable({ providedIn: 'root' })
export class RegisterService {
  private readonly NET_TIMEOUT_MS = 12_000;

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
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return this.handleRegisterError(new Error('Sem conexão com a internet. Verifique e tente novamente.'), 'Rede');
    }

    return this.validateUserData(userData).pipe(
      switchMap(() =>
        from(createUserWithEmailAndPassword(this.auth, userData.email, password)).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
        )
      ),

      // garante que o Auth “propagou” antes do Firestore escrever (rules dependem disso)
      switchMap((cred) =>
        this.waitAuthPropagationForFirestore$(cred.user.uid).pipe(
          map(() => cred)
        )
      ),

      switchMap((cred) => {
        const now = Date.now();
        const payload: IUserRegistrationData = {
          uid: cred.user.uid,
          email: cred.user.email!,
          nickname: userData.nickname,
          acceptedTerms: {
            accepted: !!userData.acceptedTerms?.accepted,
            date: userData.acceptedTerms?.date ?? now,
          },
          emailVerified: false,
          isSubscriber: false,
          profileCompleted: false,
          registrationDate: userData.registrationDate ?? now,
          firstLogin: userData.firstLogin ?? now,
        };

        return this.persistUserAndIndexAtomic(cred.user.uid, userData.nickname, payload).pipe(
          map((): SignupContext => ({ cred, warns: [] })),
          catchError(err => throwError(() => err))
        );
      }),

      switchMap((ctx2) =>
        this.emailVerificationService.sendEmailVerification(ctx2.cred.user).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          catchError((err) => {
            this.safeHandle('[RegisterService] Falha ao enviar e-mail de verificação (warn).', err);
            ctx2.warns.push('email-verification-failed');
            return of(void 0);
          }),
          map(() => ctx2)
        )
      ),

      switchMap((ctx2) =>
        from(updateProfile(ctx2.cred.user, { displayName: userData.nickname, photoURL: '' })).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          catchError((err) => {
            this.safeHandle('[RegisterService] Falha no updateProfile (warn).', err);
            ctx2.warns.push('update-profile-failed');
            return of(void 0);
          }),
          map(() => ctx2)
        )
      ),

      tap((ctx2) => {
        const { user } = ctx2.cred;
        const now = Date.now();
        this.seedLocalStateAfterSignup(user.uid, {
          uid: user.uid,
          email: user.email || '',
          nickname: userData.nickname,
          emailVerified: false,
          isSubscriber: false,
          profileCompleted: false,
          registrationDate: userData.registrationDate ?? now,
          firstLogin: userData.firstLogin ?? now,
          acceptedTerms: userData.acceptedTerms,
        });

        if (!environment.production && ctx2.warns.length) {
          // logs leves em dev
          console.debug('[RegisterService] Warn(s):', ctx2.warns.join(', '));
        }
      }),

      map((ctx2) => ctx2.cred),

      catchError((err) => this.handleRegisterError(err, 'Registro'))
    );
  }

  /**
 * =============================================================================
 * waitAuthPropagationForFirestore$
 * - Evita race-condition: createUser retorna cred, mas Firestore ainda pode estar com user=null
 * - Só libera quando onIdTokenChanged já está com o uid esperado
 * - Mantém fluxo 100% reativo (Observable)
 * =============================================================================
 */
  private waitAuthPropagationForFirestore$(expectedUid: string): Observable<void> {
     // se já está ok, não espera evento nenhum
    if (this.auth.currentUser?.uid === expectedUid) return of(void 0);
    return from(this.auth.currentUser?.getIdToken(true) ?? Promise.resolve('')).pipe(
      switchMap(() =>
        new Observable<void>((subscriber) => {
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
        })
      ),
      timeout({ each: this.NET_TIMEOUT_MS }),
      take(1),
      map(() => void 0),
      catchError((err) => this.handleRegisterError(err, 'Sincronização Auth/Firestore'))
    );
  }

  private validateUserData(user: IUserRegistrationData): Observable<void> {
    const nickname = user.nickname?.trim() || '';
    if (nickname.length < 4 || nickname.length > 24) {
      return this.handleRegisterError(new Error('Apelido deve ter entre 4 e 24 caracteres.'), 'Validação');
    }
    if (!this.isValidEmailFormat(user.email)) {
      return this.handleRegisterError(new Error('Formato de e-mail inválido.'), 'Validação');
    }

    return this.firestoreValidation.checkIfNicknameExists(nickname).pipe(
      switchMap((exists) => {
        if (exists) return this.handleRegisterError(new Error('Apelido já está em uso.'), 'Validação');
        return this.checkIfEmailExists(user.email);
      })
    );
  }

  isValidEmailFormat(email: string): boolean {
    return ValidatorService.isValidEmail(email);
  }

  private checkIfEmailExists(email: string): Observable<void> {
    return from(fetchSignInMethodsForEmail(this.auth, email)).pipe(
      switchMap((methods) => {
        if (!methods || methods.length === 0) return of(void 0);

        return from(sendPasswordResetEmail(this.auth, email)).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          switchMap(() =>
            throwError(() => ({
              code: 'email-exists-soft',
              message: 'Se existir uma conta com este e-mail, você receberá instruções para recuperar o acesso.'
            }))
          )
        );
      }),
      catchError((err) => {
        if ((err as FirebaseError)?.code === 'auth/network-request-failed') {
          return this.handleRegisterError(
            new Error('Conexão instável ao verificar e-mail. Tente novamente.'),
            'Verificação de e-mail'
          );
        }
        return throwError(() => err);
      })
    );
  }

  private persistUserAndIndexAtomic(uid: string, nickname: string, payload: IUserRegistrationData): Observable<void> {
    const normalized = nickname.trim().toLowerCase();

    return this.ctx.deferPromise$(() =>
      runTransaction(this.db as any, async (transaction) => {
        const userRef = doc(this.db as any, 'users', uid).withConverter(userConverter as any);
        const indexRef = doc(this.db as any, 'public_index', `nickname:${normalized}`);

        // ✅ novo: public profile (discovery)
        const publicProfileRef = doc(this.db as any, 'public_profiles', uid);

        const idxSnap = await transaction.get(indexRef);
        if (idxSnap.exists()) {
          const err: any = new Error('Apelido já está em uso.');
          err.code = 'nickname/in-use';
          throw err;
        }

        transaction.set(
          userRef,
          { ...payload, nicknameHistory: [{ nickname: normalized, date: Date.now() }] },
          { merge: true }
        );

        transaction.set(indexRef, {
          type: 'nickname',
          value: normalized,
          uid,
          createdAt: Timestamp.now(),
          lastChangedAt: Timestamp.now()
        });

        // ✅ cria doc público mínimo (enriquece depois via edição de perfil)
        transaction.set(publicProfileRef, {
          uid,
          nickname: nickname.trim(),
          nicknameNormalized: normalized,
          role: 'basic',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      })
    ).pipe(
      map(() => void 0),
      catchError(err => throwError(() => err))
    );
  }

  deleteUserOnFailure(uid: string): Observable<void> {
    const currentUser = this.auth.currentUser;
    if (currentUser?.uid === uid) {
      return from(currentUser.delete()).pipe(
        catchError((error) => {
          this.globalErrorHandler.handleError(error);
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
      emailVerified: !!data.emailVerified,
      isSubscriber: !!data.isSubscriber,
      profileCompleted: !!data.profileCompleted,
      firstLogin: typeof data.firstLogin === 'number' ? data.firstLogin : now,
      registrationDate: typeof data.registrationDate === 'number' ? data.registrationDate : now,
      acceptedTerms: { accepted: !!data.acceptedTerms?.accepted, date: data.acceptedTerms?.date ?? now },
    };

    this.currentUserStore.set(snapshot as any);
    this.cache.syncCurrentUserWithUid(snapshot as any);
  }

  private handleRegisterError(error: any, context = 'Erro no registro'): Observable<never> {
    const message = this.mapErrorMessage(error);
    this.safeHandle(`[RegisterService] ${context}`, error, { mappedMessage: message });

    const userErr: any = new Error(message);
    if (error && (error as any).code) userErr.code = (error as any).code;
    return throwError(() => userErr);
  }

  private mapErrorMessage(error: any): string {
    if ((error as any)?.code === 'email-exists-soft') {
      return (error as any).message ?? 'E-mail já cadastrado.';
    }

    if (error instanceof FirebaseError) {
      switch (error.code) {
        case 'auth/email-already-in-use':
          return 'Se existir uma conta com este e-mail, você receberá instruções para recuperar o acesso.';
          // segurança: não vaza info sobre existência de conta
        case 'auth/weak-password': return 'Senha fraca. Ela precisa ter pelo menos 6 caracteres.';
        case 'auth/invalid-email': return 'Formato de e-mail inválido.';
        case 'auth/network-request-failed': return 'Problema de conexão. Verifique sua internet.';
        case 'deadline-exceeded': return 'Tempo de resposta excedido. Tente novamente.';
        default: return `Erro no registro (${error.code}).`;
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
      this.globalErrorHandler.handleError(e);
    } catch { }
  }
} // 343 linhas - já está no limite
