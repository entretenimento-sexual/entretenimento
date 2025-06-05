// src/app/core/services/autentication/register.service.ts
import { Injectable } from '@angular/core';
import { UserCredential, createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, map, tap } from 'rxjs/operators';

import { FirestoreService } from '../../data-handling/firestore.service';
import { updateProfile } from 'firebase/auth';
import { GeolocationService } from '../../geolocation/geolocation.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreUserQueryService } from '../../data-handling/firestore-user-query.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { ValidatorService } from '../../general/validator.service';
import { EmailVerificationService } from './email-verification.service';
import { FirestoreValidationService } from '../../data-handling/firestore-validation.service';

@Injectable({
  providedIn: 'root',
})
export class RegisterService {
  constructor(
    private firestoreService: FirestoreService,
    private emailVerificationService: EmailVerificationService,
    private geolocationService: GeolocationService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private firestoreValidation: FirestoreValidationService,
  ) {
    console.log('[RegisterService] Firestore carregado:', this.firestoreService.getFirestoreInstance());
  }

  registerUser(userRegistrationData: IUserRegistrationData, password: string): Observable<UserCredential> {
    return this.checkNicknameAndEmail(userRegistrationData).pipe(
      switchMap(() => this.createUserAuth(userRegistrationData.email, password)),
      switchMap((userCredential) => this.persistUserAndSendVerification(userCredential, userRegistrationData)),
      catchError((error) => {
        this.globalErrorHandler.handleError(error);
        return throwError(() => error);
      })
    );
  }

  private checkNicknameAndEmail(user: IUserRegistrationData): Observable<void> {
    return this.firestoreValidation.checkIfNicknameExists(user.nickname).pipe(
      switchMap((nicknameExists) => {
        if (nicknameExists) {
          return throwError(() => new Error('Apelido já está em uso.'));
        }
        return this.checkIfEmailExists(user.email);
      })
    );
  }

  private createUserAuth(email: string, password: string): Observable<UserCredential> {
    return from(createUserWithEmailAndPassword(getAuth(), email, password));
  }

  private persistUserAndSendVerification(
    userCredential: UserCredential,
    userRegistrationData: IUserRegistrationData
  ): Observable<UserCredential> {
    const user = userCredential.user;
    const userData: IUserRegistrationData = {
      ...userRegistrationData,
      uid: user.uid,
      firstLogin: Timestamp.fromDate(new Date()),
      emailVerified: false,
      registrationDate: new Date()
    };

    return from(this.geolocationService.getCurrentLocation()).pipe(
      tap((location) => {
        if (location) {
          userData.latitude = location.latitude;
          userData.longitude = location.longitude;
        }
      }),
      catchError((err) => {
        console.log('⚠️ Localização falhou:', err);
        return of(null);
      }),
      switchMap(() => this.firestoreService.saveInitialUserData(user.uid, userData)),
      switchMap(() => this.firestoreService.savePublicIndexNickname(userData.nickname)),

      // ✅ Atualiza o perfil do Firebase Auth
      switchMap(() => from(updateProfile(user, {
        displayName: userData.nickname,
        photoURL: userData.photoURL || ''
      }))),

      // ✅ Envia o e-mail de verificação
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
      catchError((error) => {
        this.globalErrorHandler.handleError(error);
        return of(void 0);
      })
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
}
