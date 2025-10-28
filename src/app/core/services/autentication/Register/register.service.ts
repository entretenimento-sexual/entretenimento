// src/app/core/services/autentication/register/register.service.ts
import { Injectable } from '@angular/core';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, map, tap, timeout } from 'rxjs/operators';
import { Auth } from '@angular/fire/auth';
import { doc, runTransaction, writeBatch, Timestamp } from 'firebase/firestore';
import { FirestoreService } from '../../data-handling/firestore.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreValidationService } from '../../data-handling/firestore-validation.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from './email-verification.service';
import { ValidatorService } from '../../general/validator.service';
import { FirebaseError } from 'firebase/app';
import { environment } from 'src/environments/environment';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile,
         UserCredential } from 'firebase/auth';
import { userConverter } from '../../data-handling/converters/user.firestore-converter';
import { CurrentUserStoreService } from '../auth/current-user-store.service';
import { CacheService } from '../../general/cache/cache.service';

type SignupContext = {
  cred: UserCredential;
  warns: string[];
};

@Injectable({ providedIn: 'root' })
export class RegisterService {
  private readonly NET_TIMEOUT_MS = 12_000;

  constructor(
    private firestoreService: FirestoreService,
    private emailVerificationService: EmailVerificationService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private firestoreValidation: FirestoreValidationService,
    private currentUserStore: CurrentUserStoreService,
    private cache: CacheService,
    // ⬇️ injeta a instância de Auth fornecida por provideAuth(...)
    private auth: Auth,
  ) {
    if (!environment.production) {
      console.log('[RegisterService] Serviço carregado.');
    }
  }

  registerUser(userData: IUserRegistrationData, password: string): Observable<UserCredential> {
    console.log('[RegisterService] registerUser iniciado', userData);

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return this.handleRegisterError(new Error('Sem conexão com a internet. Verifique e tente novamente.'), 'Rede');
    }

    return this.validateUserData(userData).pipe(
      switchMap(() =>
        from(createUserWithEmailAndPassword(this.auth, userData.email, password)).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
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
          catchError(err => this.rollbackUser(cred.user.uid, err))
        );
      }),

      switchMap((ctx) =>
        this.emailVerificationService.sendEmailVerification(ctx.cred.user).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          catchError((err) => {
            console.log('[RegisterService] Falha ao enviar e-mail de verificação:', err);
            ctx.warns.push('email-verification-failed');
            return of(void 0);
          }),
          map(() => ctx)
        )
      ),

      switchMap((ctx) =>
        from(updateProfile(ctx.cred.user, { displayName: userData.nickname, photoURL: '' })).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          catchError((err) => {
            console.log('[RegisterService] Falha no updateProfile:', err);
            ctx.warns.push('update-profile-failed');
            return of(void 0);
          }),
          map(() => ctx)
        )
      ),

      tap((ctx) => {
        const { user } = ctx.cred;
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
        if (ctx.warns.length) {
          console.log('[RegisterService] Aviso(s) não-críticos na criação:', ctx.warns.join(', '));
        }
      }),

      map((ctx) => ctx.cred),

      catchError((err) => this.handleRegisterError(err, 'Registro'))
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
        if (exists) {
          return this.handleRegisterError(new Error('Apelido já está em uso.'), 'Validação');
        }
        return this.checkIfEmailExists(user.email);
      })
    );
  }

  isValidEmailFormat(email: string): boolean {
    return ValidatorService.isValidEmail(email);
  }

  private checkIfEmailExists(email: string): Observable<void> {
    return this.firestoreService.checkIfEmailExists(email).pipe(
      switchMap((exists) => {
        if (!exists) return of(void 0);
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

  private persistUserAndIndexAtomic(
    uid: string,
    nickname: string,
    payload: IUserRegistrationData
  ): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();
    const normalized = nickname.trim().toLowerCase();

    const userRef = doc(db, 'users', uid).withConverter(userConverter);
    const indexRef = doc(db, 'public_index', `nickname:${normalized}`);

    return from(runTransaction(db, async (transaction) => {
      const idxSnap = await transaction.get(indexRef);
      if (idxSnap.exists()) {
        const err: any = new Error('Apelido já está em uso.');
        err.code = 'nickname-in-use';
        throw err;
      }

      transaction.set(
        userRef,
        {
          ...payload,
          nicknameHistory: [{ nickname: normalized, date: Date.now() }] // ✅ epoch (ms)
        },
        { merge: true }
      );

      // índice pode ficar com Timestamp; não vai pro Store
      transaction.set(indexRef, {
        type: 'nickname',
        value: normalized,
        uid,
        createdAt: Timestamp.now(),
        lastChangedAt: Timestamp.now()
      });
    })).pipe(
      tap(() => console.debug('[RegisterService] persistUserAndIndexAtomic → OK')),
      map(() => void 0)
    );
  }

  private cleanupOnFailure(uid: string, nickname: string): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();
    const normalized = nickname.trim().toLowerCase();

    const userRef = doc(db, 'users', uid);
    const indexRef = doc(db, 'public_index', `nickname:${normalized}`);
    const batch = writeBatch(db);

    console.log('[RegisterService] cleanupOnFailure → iniciando cleanup', { uid, normalized });

    batch.delete(userRef);
    batch.delete(indexRef);

    return from(batch.commit()).pipe(
      catchError(err => {
        console.log('[RegisterService] cleanupOnFailure → falha ao limpar Firestore/Índice', err);
        return of(void 0);
      }),
      switchMap(() => this.deleteUserOnFailure(uid)),
      catchError(() => of(void 0)),
      map(() => void 0)
    );
  }

  private rollbackUser(uid: string, error: any): Observable<never> {
    return from(this.deleteUserOnFailure(uid)).pipe(
      switchMap(() => throwError(() => error)),
      catchError((rollbackErr) => {
        this.globalErrorHandler.handleError(rollbackErr);
        return throwError(() => error);
      })
    );
  }

  deleteUserOnFailure(uid: string): Observable<void> {
    const currentUser = this.auth.currentUser;
    if (currentUser?.uid === uid) {
      return from(currentUser.delete()).pipe(
        tap(() => console.debug('[RegisterService] usuário deletado com sucesso')),
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

      acceptedTerms: {
        accepted: !!data.acceptedTerms?.accepted,
        date: data.acceptedTerms?.date ?? now,
      },
    };

    this.currentUserStore.set(snapshot as any);
    this.cache.syncCurrentUserWithUid(snapshot as any);
    console.log('[RegisterService] Estado local semeado (CurrentUserStore/Cache).');
  }

  private handleRegisterError(error: any, context = 'Erro no registro'): Observable<never> {
    const message = this.mapErrorMessage(error);
    console.log(`[${context}]`, error);
    this.globalErrorHandler.handleError(new Error(message));
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
        case 'auth/email-already-in-use': return 'Este e-mail já está em uso. Tente outro.';
        case 'auth/weak-password': return 'Senha fraca. Ela precisa ter pelo menos 6 caracteres.';
        case 'auth/invalid-email': return 'Formato de e-mail inválido.';
        case 'auth/network-request-failed': return 'Problema de conexão. Verifique sua internet.';
        case 'deadline-exceeded': return 'Tempo de resposta excedido. Tente novamente.';
        default: return `Erro no registro (${error.code}).`;
      }
    }

    if (error?.name === 'TimeoutError') {
      return 'Conexão lenta. Tente novamente em instantes.';
    }

    if (error instanceof Error) return error.message;
    return 'Erro inesperado no processo de registro.';
  }
}
