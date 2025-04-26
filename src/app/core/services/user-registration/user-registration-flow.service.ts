// src/app/core/services/user-registration/user-registration-flow.service.ts
import { Injectable } from '@angular/core';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { Observable, of, throwError, from } from 'rxjs';
import { catchError, switchMap, tap, map } from 'rxjs/operators';
import { RegisterService } from '../autentication/register/register.service';
import { EmailVerificationService } from '../autentication/register/email-verification.service';
import { FirestoreService } from '../data-handling/firestore.service';
import { GeolocationService } from '../geolocation/geolocation.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { Timestamp } from '@firebase/firestore';
import { User, getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

@Injectable({
  providedIn: 'root',
})
export class UserRegistrationFlowService {
  constructor(
    private registerService: RegisterService,
    private emailVerificationService: EmailVerificationService,
    private firestoreService: FirestoreService,
    private geolocationService: GeolocationService,
    private globalErrorHandler: GlobalErrorHandlerService
  ) { }

  /**
   * Etapa 1: Valida dados de entrada como e-mail e nickname
   */
  private validateNewUserData(user: IUserRegistrationData): Observable<void> {
    const nickname = user.nickname.trim();
    if (nickname.length < 4 || nickname.length > 24) {
      return throwError(() => new Error('Apelido deve ter entre 4 e 24 caracteres.'));
    }
    if (!this.registerService.isValidEmailFormat(user.email)) {
      return throwError(() => new Error('Formato de e-mail inválido.'));
    }

    return this.registerService.checkIfEmailExists(user.email).pipe(
      switchMap(() => this.registerService['firestoreValidation'].checkIfNicknameExists(nickname)),
      switchMap(nicknameExists => {
        if (nicknameExists) {
          return throwError(() => new Error('Apelido já está em uso.'));
        }
        return of(void 0);
      })
    );
  }

  /**
   * Etapa 2: Cria o usuário no Auth
   */
  private createAuthUser(email: string, password: string): Observable<{ user: User }> {
    return from(createUserWithEmailAndPassword(getAuth(), email, password)).pipe(
      map((cred) => ({ user: cred.user }))
    );
  }

  /**
   * Orquestra todo o fluxo de registro do usuário.
   */
  handleNewUserRegistration(userData: IUserRegistrationData, password: string): Observable<void> {
    return this.validateNewUserData(userData).pipe(
      switchMap(() => this.createAuthUser(userData.email, password)),
      switchMap(({ user }) =>
        from(this.geolocationService.getCurrentLocation()).pipe(
          catchError(() => of({ latitude: null, longitude: null })),
          map((location: any) => ({
            ...userData,
            uid: user.uid,
            emailVerified: false,
            registrationDate: new Date(),
            firstLogin: Timestamp.fromDate(new Date()),
            latitude: location.latitude,
            longitude: location.longitude,
          }))
        )
      ),
      switchMap((preparedUserData: IUserRegistrationData) =>
        this.firestoreService.saveInitialUserData(preparedUserData.uid!, preparedUserData)
      ),
      switchMap(() => this.emailVerificationService.sendEmailVerification(getAuth().currentUser!)),
      tap(() => console.log('[UserRegistrationFlow] Fluxo completo de registro finalizado')),
      map(() => void 0),
      catchError((error) => {
        this.globalErrorHandler.handleError(error);
        return throwError(() => error);
      })
    );
  }
}
