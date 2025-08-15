//src\app\core\services\autentication\register\register.service.ts
import { Injectable } from '@angular/core';
import {
  createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail,
  updateProfile, UserCredential
} from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
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
    console.debug('[RegisterService] registerUser iniciado com', userData, 'e senha <>***');
    return this.validateUserData(userData).pipe(
      switchMap(() => this.createFirebaseUser(userData.email, password)),
      tap(cred => console.debug('[RegisterService] usuário criado no Auth:', cred.user.uid)),
      switchMap((cred) => this.persistUserAndSendVerification(cred, userData)),
      catchError((err) => this.handleRegisterError(err, 'Registro'))
    );
  }

  private validateUserData(user: IUserRegistrationData): Observable<void> {
    const nickname = user.nickname?.trim() || '';
    console.debug('[RegisterService] validateUserData nickname:', nickname, 'length:', nickname.length);

    if (nickname.length < 4 || nickname.length > 24) {
      console.error('[RegisterService] validateUserData: apelido fora do tamanho permitido');
      return this.handleRegisterError(new Error('Apelido deve ter entre 4 e 24 caracteres.'), 'Validação');
    }
    if (!this.isValidEmailFormat(user.email)) {
      console.error('[RegisterService] validateUserData: formato de e-mail inválido');
      return this.handleRegisterError(new Error('Formato de e-mail inválido.'), 'Validação');
    }

    return this.firestoreValidation.checkIfNicknameExists(nickname).pipe(
      tap(exists => console.debug('[RegisterService] checkIfNicknameExists ->', exists)),
      switchMap((exists) => {
        if (exists) {
          console.error('[RegisterService] validateUserData: apelido já está em uso');
          return this.handleRegisterError(new Error('Apelido já está em uso.'), 'Validação');
        }
        console.debug('[RegisterService] validateUserData: apelido disponível, validando e-mail');
        return this.checkIfEmailExists(user.email).pipe(
          tap(() => console.debug('[RegisterService] checkIfEmailExists: e-mail não existe ou reset enviado'))
        );
      })
    );
  }

  private createFirebaseUser(email: string, password: string): Observable<UserCredential> {
    console.debug('[RegisterService] createFirebaseUser: entrando em createUserWithEmailAndPassword');
    return from(createUserWithEmailAndPassword(getAuth(), email, password));
  }

  private persistUserAndSendVerification(
    cred: UserCredential,
    userData: IUserRegistrationData
  ): Observable<UserCredential> {
    console.debug('[RegisterService] persistUserAndSendVerification: cred.user.uid =', cred.user.uid);
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

    return this.firestoreService.saveInitialUserData(cred.user.uid, payload).pipe(
      tap(() => console.debug('[RegisterService] saveInitialUserData concluído')),
      switchMap(() => this.firestoreService.savePublicIndexNickname(userData.nickname)),
      tap(() => console.debug('[RegisterService] savePublicIndexNickname concluído')),
      switchMap(() => from(updateProfile(cred.user, { displayName: userData.nickname, photoURL: '' }))),
      tap(() => console.debug('[RegisterService] updateProfile concluído')),
      switchMap(() => this.emailVerificationService.sendEmailVerification(cred.user)),
      tap(() => console.debug('[RegisterService] sendEmailVerification concluído')),
      map(() => cred),
      catchError((error) => this.rollbackUser(cred.user.uid, error))
    );
  }

  private rollbackUser(uid: string, error: any): Observable<never> {
    console.error('[RegisterService] Rollback iniciado para uid:', uid, 'erro:', error);
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
    console.debug('[RegisterService] checkIfEmailExists:', email);
    return from(this.firestoreService.checkIfEmailExists(email)).pipe(
      tap(exists => console.debug('[RegisterService] firestoreService.checkIfEmailExists ->', exists)),
      switchMap((exists) => {
        if (exists) {
          console.warn('[RegisterService] checkIfEmailExists: e-mail já existe, enviando reset');
          return from(sendPasswordResetEmail(getAuth(), email));
        }
        return of(void 0);
      })
    );
  }

  private handleRegisterError(error: any, context = 'Erro no registro'): Observable<never> {
    const message = this.mapErrorMessage(error);
    console.error(`[${context}]`, error);
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
