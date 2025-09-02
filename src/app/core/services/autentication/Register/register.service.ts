// src/app/core/services/autentication/register/register.service.ts
import { Injectable } from '@angular/core';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, map, tap } from 'rxjs/operators';

import {getAuth,
        createUserWithEmailAndPassword,
        sendPasswordResetEmail,
        updateProfile,
        UserCredential,
      } from 'firebase/auth';

import {doc,
        runTransaction,
        writeBatch,
        Timestamp,
      } from 'firebase/firestore';

import { FirestoreService } from '../../data-handling/firestore.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreValidationService } from '../../data-handling/firestore-validation.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from './email-verification.service';
import { ValidatorService } from '../../general/validator.service';
import { FirebaseError } from 'firebase/app';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class RegisterService {
  // ✅ usa SDK Web diretamente (sem DI do Auth)
  private readonly auth = getAuth();

  constructor(
    private firestoreService: FirestoreService,
    private emailVerificationService: EmailVerificationService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private firestoreValidation: FirestoreValidationService
  ) {
    if (!environment.production) {
      console.log('[RegisterService] Serviço carregado.');
    }
  }

  registerUser(userData: IUserRegistrationData, password: string): Observable<UserCredential> {
    console.log('[RegisterService] registerUser iniciado', userData);

    return this.validateUserData(userData).pipe(
      // 1) cria usuário no Auth
      switchMap(() => this.createFirebaseUser(userData.email, password)),

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
          map(() => cred),
          catchError(err => this.rollbackUser(cred.user.uid, err))
        );
      }),

      // 3) envia e-mail de verificação
      switchMap((cred) =>
        this.emailVerificationService.sendEmailVerification(cred.user).pipe(
          map(() => cred),
          catchError(err =>
            this.cleanupOnFailure(cred.user.uid, userData.nickname).pipe(
              switchMap(() => this.rollbackUser(cred.user.uid, err))
            )
          )
        )
      ),

      // 4) updateProfile (rollback se falhar)
      switchMap((cred) =>
        from(updateProfile(cred.user, { displayName: userData.nickname, photoURL: '' })).pipe(
          map(() => cred),
          catchError(err =>
            this.cleanupOnFailure(cred.user.uid, userData.nickname).pipe(
              switchMap(() => this.rollbackUser(cred.user.uid, err))
            )
          )
        )
      ),

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
          switchMap(() =>
            throwError(() => ({
              code: 'email-exists-soft',
              message: 'Se existir uma conta com este e-mail, você receberá instruções para recuperar o acesso.'
            }))
          )
        );
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
  private createFirebaseUser(email: string, password: string): Observable<UserCredential> {
    return from(createUserWithEmailAndPassword(this.auth, email, password));
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

  // -------------------- Erros --------------------
  private handleRegisterError(error: any, context = 'Erro no registro'): Observable<never> {
    const message = this.mapErrorMessage(error);
    console.log(`[${context}]`, error);
    this.globalErrorHandler.handleError(new Error(message));
    return throwError(() => new Error(message));
  }

  private mapErrorMessage(error: any): string {
    if ((error as any)?.code === 'email-exists-soft') {
      return (error as any).message ?? 'E-mail já cadastrado.';
    }

    if (error instanceof FirebaseError) {
      switch (error.code) {
        case 'auth/email-already-in-use': return 'Este e-mail já está em uso. Tente outro ou faça login.';
        case 'auth/weak-password': return 'Senha fraca. Ela precisa ter pelo menos 6 caracteres.';
        case 'auth/invalid-email': return 'Formato de e-mail inválido.';
        case 'auth/network-request-failed': return 'Problema de conexão. Verifique sua internet.';
        default: return `Erro no registro (${error.code}).`;
      }
    }

    if (error instanceof Error) return error.message;
    return 'Erro inesperado no processo de registro.';
  }
}
