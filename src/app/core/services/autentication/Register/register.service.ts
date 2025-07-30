// src/app/core/services/autentication/register.service.ts
import { Injectable } from '@angular/core';
import {
          UserCredential, createUserWithEmailAndPassword, getAuth,
          sendPasswordResetEmail, updateProfile } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, map } from 'rxjs/operators';

import { FirestoreService } from '../../data-handling/firestore.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreUserQueryService } from '../../data-handling/firestore-user-query.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { ValidatorService } from '../../general/validator.service';
import { EmailVerificationService } from './email-verification.service';
import { FirestoreValidationService } from '../../data-handling/firestore-validation.service';
import { environment } from 'src/environments/environment';
import { FirebaseError } from 'firebase/app';

@Injectable({
  providedIn: 'root',
})
export class RegisterService {
  constructor(
    private firestoreService: FirestoreService,
    private emailVerificationService: EmailVerificationService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private firestoreValidation: FirestoreValidationService,
  ) {
    if (!environment.production) {
      console.log('[RegisterService] Firestore carregado:', this.firestoreService);
    }
  }

  registerUser(userRegistrationData: IUserRegistrationData, password: string): Observable<UserCredential> {
    if (!userRegistrationData.nickname || userRegistrationData.nickname.trim().length < 4) {
      return this.handleRegisterError(
        new Error('Apelido inválido. Escolha um com pelo menos 3 caracteres.'),
        'Validação inicial'
      );
    }

    return this.checkNicknameAndEmail(userRegistrationData).pipe(
      switchMap(() => this.createUserAuth(userRegistrationData.email, password)),
      switchMap((userCredential) => this.persistMinimalUser(userCredential, userRegistrationData)),
      catchError((error) => this.handleRegisterError(error, 'Fluxo principal de registro'))
    );
  }

  private checkNicknameAndEmail(user: IUserRegistrationData): Observable<void> {
    return this.firestoreValidation.checkIfNicknameExists(user.nickname).pipe(
      switchMap((nicknameExists) => {
        if (nicknameExists) {
          return this.handleRegisterError(new Error('Apelido já está em uso.'), 'Verificação de apelido');
        }
        return this.checkIfEmailExists(user.email);
      }),
      catchError((error) => this.handleRegisterError(error, 'Verificação de apelido/e-mail'))
    );
  }

  private createUserAuth(email: string, password: string): Observable<UserCredential> {
    return from(createUserWithEmailAndPassword(getAuth(), email, password));
  }

  private persistMinimalUser( userCredential: UserCredential,
                              userRegistrationData: IUserRegistrationData): Observable<UserCredential> {
    const user = userCredential.user;
    const minimalUserData: IUserRegistrationData = {
      uid: user.uid,
      email: user.email!,
      nickname: userRegistrationData.nickname,
      emailVerified: false,
      isSubscriber: false,
      firstLogin: Timestamp.fromDate(new Date()),
      registrationDate: new Date(),
      acceptedTerms: userRegistrationData.acceptedTerms,
      profileCompleted: false,
    };

    return this.firestoreService.saveInitialUserData(user.uid, minimalUserData).pipe(
      switchMap(() => this.firestoreService.savePublicIndexNickname(minimalUserData.nickname)),
      switchMap(() => from(updateProfile(user, {
        displayName: minimalUserData.nickname,
        photoURL: ''
      }))),
      switchMap(() => this.emailVerificationService.sendEmailVerification(user)),
      map(() => userCredential),
      catchError((error) => this.rollbackUser(user.uid, error))
    );
  }

  private rollbackUser(uid: string, error: any): Observable<never> {
    return from(this.deleteUserOnFailure(uid)).pipe(
      switchMap(() => throwError(() => error)),
      catchError((rollbackError) => {
        this.globalErrorHandler.handleError(rollbackError);
        return throwError(() => error);
      })
    );
  }

  deleteUserOnFailure(uid: string): Observable<void> {
    const auth = getAuth();
    const user = auth.currentUser;

    if (user && user.uid === uid) {
      return from(user.delete()).pipe(
        catchError((error) => {
          this.globalErrorHandler.handleError(error);
          return throwError(() => new Error('Erro ao deletar usuário.'));
        })
      );
    }
    return of(void 0);
  }

  isValidEmailFormat(email: string): boolean {
    return ValidatorService.isValidEmail(email);
  }

  checkIfEmailExists(email: string): Observable<void> {
    return from(this.firestoreService.checkIfEmailExists(email)).pipe(
      switchMap((emailExists) => {
        if (emailExists) {
          return from(sendPasswordResetEmail(getAuth(), email));
        }
        return of(void 0);
      }),
      catchError((error) => this.handleRegisterError(error, 'Verificação de e-mail'))

    );
  }

  getUserProgress(uid: string) {
    return this.firestoreUserQuery.getUser(uid).pipe(
      map((userData) => {
        if (!userData) {
          throw new Error('Usuário não encontrado.');
        }
        return userData;
      })
    );
  }

  private handleRegisterError(error: any, context = 'Erro no registro'): Observable<never> {
    let userFriendlyMessage: string;
    let consoleLogMessage: string;

    if (error instanceof FirebaseError) {
      switch (error.code) {
        case 'auth/email-already-in-use':
          userFriendlyMessage = 'Este e-mail já está em uso. Por favor, faça login ou use outro e-mail.';
          break;
        case 'auth/weak-password':
          userFriendlyMessage = 'Sua senha é muito fraca. Ela precisa ter pelo menos 6 caracteres.';
          break;
        case 'auth/invalid-email':
          userFriendlyMessage = 'O formato do e-mail é inválido. Por favor, verifique e tente novamente.';
          break;
        case 'auth/operation-not-allowed':
          userFriendlyMessage = 'O registro de e-mail/senha não está habilitado. Contate o suporte.';
          break;
        case 'auth/network-request-failed':
          userFriendlyMessage = 'Problema de conexão. Verifique sua internet e tente novamente.';
          break;
        // Erros que podem vir do Firestore na fase de persistência (rollback)
        case 'permission-denied':
          userFriendlyMessage = 'Houve um problema de permissão. Tente novamente ou contate o suporte.';
          break;
        default:
          userFriendlyMessage = `Ocorreu um problema no registro. Por favor, tente novamente. (${error.code})`;
          break;
      }
      consoleLogMessage = `[${context}] Erro Firebase (${error.code}): ${error.message}`;
    } else if (error instanceof Error) {
      // Erros customizados ou de validação inicial
      userFriendlyMessage = error.message;
      consoleLogMessage = `[${context}] Erro: ${error.message}`;
    } else {
      userFriendlyMessage = 'Ocorreu um erro inesperado no processo de registro. Tente novamente.';
      consoleLogMessage = `[${context}] Erro desconhecido: ${JSON.stringify(error)}`;
    }

    // SUPERVALORIZAÇÃO DO LOG NO CONSOLE PARA O DEV
    console.log(consoleLogMessage, error);

    // PASSA A MENSAGEM AMIGÁVEL PARA O GLOBAL ERROR HANDLER QUE A EXIBIRÁ AO USUÁRIO
    // Criamos um novo objeto Error com a mensagem amigável para que o GlobalErrorHandler
    // possa exibi-la diretamente.
    this.globalErrorHandler.handleError(new Error(userFriendlyMessage));

    return throwError(() => error); // Re-lança o erro original para que a cadeia RXJS continue com o erro real
  }
}

