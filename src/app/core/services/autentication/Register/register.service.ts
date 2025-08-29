//src\app\core\services\autentication\register\register.service.ts
import { Injectable } from '@angular/core';
import {
          createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail,
          updateProfile, UserCredential } from 'firebase/auth';
import { Timestamp, doc, runTransaction, writeBatch } from 'firebase/firestore';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, map, tap } from 'rxjs/operators';

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
      switchMap(() => this.createFirebaseUser(userData.email, password)),

      // grava User + Índice de forma atômica primeiro
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
          firstLogin: Timestamp.fromDate(new Date())
        };
        return this.persistUserAndIndexAtomic(cred.user.uid, userData.nickname, payload).pipe(
          map(() => cred),
          catchError(err => this.rollbackUser(cred.user.uid, err))
        );
      }),

      // envia e-mail depois; se falhar, limpa tudo
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

      // por último, updateProfile; se falhar, limpa tudo
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


  private validateUserData(user: IUserRegistrationData): Observable<void> {
    const nickname = user.nickname?.trim() || '';
    console.debug('[RegisterService] validateUserData nickname:', nickname, 'length:', nickname.length);

    if (nickname.length < 4 || nickname.length > 24) {
      console.log('[RegisterService] validateUserData: apelido fora do tamanho permitido');
      return this.handleRegisterError(new Error('Apelido deve ter entre 4 e 24 caracteres.'), 'Validação');
    }
    if (!this.isValidEmailFormat(user.email)) {
      console.log('[RegisterService] validateUserData: formato de e-mail inválido');
      return this.handleRegisterError(new Error('Formato de e-mail inválido.'), 'Validação');
    }

    return this.firestoreValidation.checkIfNicknameExists(nickname).pipe(
      tap(exists => console.debug('[RegisterService] checkIfNicknameExists ->', exists)),
      switchMap((exists) => {
        if (exists) {
          console.log('[RegisterService] validateUserData: apelido já está em uso');
          return this.handleRegisterError(new Error('Apelido já está em uso.'), 'Validação');
        }
        console.debug('[RegisterService] validateUserData: apelido disponível, validando e-mail');
        return this.checkIfEmailExists(user.email).pipe(
          tap(() => console.debug('[RegisterService] checkIfEmailExists: e-mail não existe ou reset enviado'))
        );
      })
    );
  }

  /** Persiste user + índice do apelido de forma ATÔMICA (tudo ou nada). */
  private persistUserAndIndexAtomic(
    uid: string,
    nickname: string,
    payload: IUserRegistrationData
  ): Observable<void> {
    // pode haver pequeno desencontro de tipos entre AngularFire e SDK web → use 'as any' se o TS reclamar
    const db: any = this.firestoreService.getFirestoreInstance();

    const normalized = nickname.trim().toLowerCase();
    const userRef = doc(db, 'users', uid);
    const indexRef = doc(db, 'public_index', `nickname:${normalized}`);

    console.debug('[RegisterService] persistUserAndIndexAtomic → iniciando transaction', { uid, normalized });

    return from(runTransaction(db, async (tx: any) => {
      // 1) unicidade do apelido (evita corrida)
      const idxSnap = await tx.get(indexRef);
      if (idxSnap.exists()) {
        const err: any = new Error('Apelido já está em uso.');
        err.code = 'nickname-in-use';
        throw err;
      }

      // 2) grava o documento do usuário
      tx.set(userRef, {
        ...payload,
        nicknameHistory: [
          { nickname: normalized, date: Timestamp.now() }
        ]
      }, { merge: true });

      // 3) grava o índice público do apelido
      tx.set(indexRef, {
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

  /** Limpeza completa se algo falhar depois do Auth: apaga user doc, índice e o Auth user. */
  private cleanupOnFailure(uid: string, nickname: string): Observable<void> {
    const db: any = this.firestoreService.getFirestoreInstance();

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
        // segue o fluxo mesmo assim
        return of(void 0);
      }),
      // por fim, apaga o usuário do Auth (se ainda estiver logado)
      switchMap(() => this.deleteUserOnFailure(uid)),
      catchError(err => {
        console.log('[RegisterService] cleanupOnFailure → falha ao deletar Auth user', err);
        return of(void 0);
      }),
      map(() => void 0)
    );
  }

  private createFirebaseUser(email: string, password: string): Observable<UserCredential> {
    console.debug('[RegisterService] createFirebaseUser: entrando em createUserWithEmailAndPassword');
    return from(createUserWithEmailAndPassword(getAuth(), email, password));
  }

  private rollbackUser(uid: string, error: any): Observable<never> {
    console.log('[RegisterService] Rollback iniciado para uid:', uid, 'erro:', error);
    return from(this.deleteUserOnFailure(uid)).pipe(
      switchMap(() => throwError(() => error)),
      catchError((rollbackErr) => {
        this.globalErrorHandler.handleError(rollbackErr);
        return throwError(() => error);
      })
    );
  }

  deleteUserOnFailure(uid: string): Observable<void> {
    console.debug('[RegisterService] deleteUserOnFailure:', uid);
    const auth = getAuth();
    const currentUser = auth.currentUser;
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

  isValidEmailFormat(email: string): boolean {
    const valid = ValidatorService.isValidEmail(email);
    console.debug('[RegisterService] isValidEmailFormat:', email, '->', valid);
    return valid;
  }

  private checkIfEmailExists(email: string): Observable<void> {
    console.log('[RegisterService] checkIfEmailExists:', email);
    return from(this.firestoreService.checkIfEmailExists(email)).pipe(
      switchMap((exists) => {
        if (!exists) return of(void 0);
        // envia reset e encerra com erro tipado "suave"
        return from(sendPasswordResetEmail(getAuth(), email)).pipe(
          switchMap(() => throwError(() => ({
            code: 'email-exists-soft',
            message: 'Se existir uma conta com este e-mail, você receberá instruções para recuperar o acesso.'
          })))
        );
      })
    );
  }

  private handleRegisterError(error: any, context = 'Erro no registro'): Observable<never> {
    const message = this.mapErrorMessage(error);
    console.log(`[${context}]`, error);
    this.globalErrorHandler.handleError(new Error(message));
    return throwError(() => new Error(message));
  }

  private mapErrorMessage(error: any): string {
    if (error instanceof FirebaseError) {
      switch (error.code) {
        case 'auth/email-already-in-use':
          return 'Este e-mail já está em uso. Tente outro ou faça login.';
        case 'auth/weak-password':
          return 'Senha fraca. Ela precisa ter pelo menos 6 caracteres.';
        case 'auth/invalid-email':
          return 'Formato de e-mail inválido.';
        case 'auth/network-request-failed':
          return 'Problema de conexão. Verifique sua internet.';
        default:
          return `Erro no registro (${error.code}).`;
      }
    }
    if (error instanceof Error) return error.message;
    return 'Erro inesperado no processo de registro.';
  }
}
