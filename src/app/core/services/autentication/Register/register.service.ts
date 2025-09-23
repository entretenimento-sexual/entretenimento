// src/app/core/services/autentication/register/register.service.ts
import { Injectable, Inject } from '@angular/core';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, map, tap, timeout } from 'rxjs/operators';

import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  UserCredential,
  type Auth,
} from 'firebase/auth';

import {
  doc,
  runTransaction,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';

import { FIREBASE_AUTH } from '../../../firebase/firebase.tokens';
import { FirestoreService } from '../../data-handling/firestore.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreValidationService } from '../../data-handling/firestore-validation.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from './email-verification.service';
import { ValidatorService } from '../../general/validator.service';
import { FirebaseError } from 'firebase/app';
import { environment } from 'src/environments/environment';

// novos serviços “substitutivos” ao antigo AuthService
import { CurrentUserStoreService } from '../auth/current-user-store.service';
import { CacheService } from '../../general/cache/cache.service';

type SignupContext = {
  cred: UserCredential;
  warns: string[];
};

@Injectable({ providedIn: 'root' })
export class RegisterService {
  // ⏱️ timeouts defensivos p/ rede lenta
  private readonly NET_TIMEOUT_MS = 12_000;

  constructor(
    private firestoreService: FirestoreService,
    private emailVerificationService: EmailVerificationService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private firestoreValidation: FirestoreValidationService,
    private currentUserStore: CurrentUserStoreService,
    private cache: CacheService,
    @Inject(FIREBASE_AUTH) private auth: Auth, // ✅ Auth único via DI
  ) {
    if (!environment.production) {
      console.log('[RegisterService] Serviço carregado.');
    }
  }

  /**
   * Fluxo principal de registro
   * - Valida dados
   * - Cria user no Auth
   * - Persiste users/{uid} + índice de apelido (transação)
   * - Envia e-mail de verificação (sem rollback em falha)
   * - updateProfile(displayName) (sem rollback em falha)
   * - Semeia estado local (CurrentUserStore + Cache) com emailVerified=false
   */
  registerUser(userData: IUserRegistrationData, password: string): Observable<UserCredential> {
    console.log('[RegisterService] registerUser iniciado', userData);

    // ⚠️ guarda simples: não inicia se offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return this.handleRegisterError(new Error('Sem conexão com a internet. Verifique e tente novamente.'), 'Rede');
    }

    return this.validateUserData(userData).pipe(
      // 1) cria usuário no Auth
      switchMap(() =>
        this.createFirebaseUser(userData.email, password).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
        )
      ),

      // 2) grava user + índice (transação atômica)
      switchMap((cred) => {
        const payload: IUserRegistrationData = {
          uid: cred.user.uid,
          email: cred.user.email!,
          nickname: userData.nickname,
          acceptedTerms: userData.acceptedTerms,
          emailVerified: false,
          isSubscriber: false,
          profileCompleted: false,
          registrationDate: new Date(),
          firstLogin: Timestamp.fromDate(new Date()),
        };

        return this.persistUserAndIndexAtomic(cred.user.uid, userData.nickname, payload).pipe(
          map((): SignupContext => ({ cred, warns: [] })),
          catchError(err => this.rollbackUser(cred.user.uid, err))
        );
      }),

      // 3) Envia e-mail de verificação (não é crítico → não dá rollback)
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

      // 4) updateProfile (não é crítico → não dá rollback)
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

      // 5) semeia estado local (sem depender do AuthService)
      tap((ctx) => {
        const { user } = ctx.cred;
        this.seedLocalStateAfterSignup(user.uid, {
          uid: user.uid,
          email: user.email || '',
          nickname: userData.nickname,
          emailVerified: false,
          isSubscriber: false,
          profileCompleted: false,
          registrationDate: new Date(),
          firstLogin: Timestamp.fromDate(new Date()),
          acceptedTerms: userData.acceptedTerms,
        });
        if (ctx.warns.length) {
          console.log('[RegisterService] Aviso(s) não-críticos na criação:', ctx.warns.join(', '));
        }
      }),

      // 6) devolve o UserCredential original
      map((ctx) => ctx.cred),

      catchError((err) => this.handleRegisterError(err, 'Registro'))
    );
  }

  // -------------------- Validações --------------------
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
    return from(this.firestoreService.checkIfEmailExists(email)).pipe(
      switchMap((exists) => {
        if (!exists) return of(void 0);
        // fluxo “suave”: envia reset e encerra com erro tipado
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
        // se a verificação/reset falhar por rede, trate e prossiga
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

  // ------------- Persistência atômica (user + índice) -------------
  private persistUserAndIndexAtomic(
    uid: string,
    nickname: string,
    payload: IUserRegistrationData
  ): Observable<void> {
    const db = this.firestoreService.getFirestoreInstance();

    const normalized = nickname.trim().toLowerCase();
    const userRef = doc(db, 'users', uid);
    const indexRef = doc(db, 'public_index', `nickname:${normalized}`);

    console.debug('[RegisterService] persistUserAndIndexAtomic → iniciando transaction', { uid, normalized });

    return from(runTransaction(db, async (transaction) => {
      // 1) unicidade do apelido
      const idxSnap = await transaction.get(indexRef);
      if (idxSnap.exists()) {
        const err: any = new Error('Apelido já está em uso.');
        err.code = 'nickname-in-use';
        throw err;
      }

      // 2) grava o documento do usuário
      transaction.set(userRef, {
        ...payload,
        nicknameHistory: [{ nickname: normalized, date: Timestamp.now() }]
      }, { merge: true });

      // 3) grava o índice público do apelido
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

  /** Limpa Firestore + índice e tenta deletar o Auth user (rollback) */
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

  // -------------------- Auth helpers --------------------
  private createUserWithEmailAndPasswordSafe(email: string, password: string): Observable<UserCredential> {
    return from(createUserWithEmailAndPassword(this.auth, email, password));
  }

  private createFirebaseUser(email: string, password: string): Observable<UserCredential> {
    return this.createUserWithEmailAndPasswordSafe(email, password);
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

  // -------------------- Estado local após cadastro --------------------
  private seedLocalStateAfterSignup(uid: string, data: Partial<IUserRegistrationData>): void {
    const snapshot = {
      uid,
      email: data.email || '',
      nickname: data.nickname || '',
      emailVerified: false,
      isSubscriber: false,
      profileCompleted: false,
      firstLogin: data.firstLogin || Timestamp.fromDate(new Date()),
      registrationDate: data.registrationDate || new Date(),
      acceptedTerms: data.acceptedTerms,
    } as any;

    this.currentUserStore.set(snapshot);
    this.cache.syncCurrentUserWithUid(snapshot);

    console.log('[RegisterService] Estado local semeado (CurrentUserStore/Cache).');
  }

  // -------------------- Erros --------------------
  private handleRegisterError(error: any, context = 'Erro no registro'): Observable<never> {
    const message = this.mapErrorMessage(error);
    console.log(`[${context}]`, error);
    this.globalErrorHandler.handleError(new Error(message));
    // Preserve também o code (quando existir) para a UI
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
