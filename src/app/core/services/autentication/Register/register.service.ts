// src/app/core/services/autentication/register.service.ts
import { Injectable } from '@angular/core';
import { UserCredential, createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, map, tap } from 'rxjs/operators';
import { FirestoreService } from '../../data-handling/firestore.service';
import { GeolocationService } from '../../geolocation/geolocation.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreUserQueryService } from '../../data-handling/firestore-user-query.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { ValidatorService } from '../../general/validator.service';
import { EmailVerificationService } from './email-verification.service';
import { FirestoreValidationService } from '../../data-handling/firestore-validation.service';
import { CacheService } from '../../general/cache/cache.service';

@Injectable({
  providedIn: 'root',
})
export class RegisterService {

  constructor(private firestoreService: FirestoreService,
              private emailVerificationService: EmailVerificationService,
              private geolocationService: GeolocationService,
              private globalErrorHandler: GlobalErrorHandlerService,
              private firestoreUserQuery: FirestoreUserQueryService,
              private firestoreValidation: FirestoreValidationService,
              private cacheService: CacheService)
              {
    console.log('[RegisterService] Firestore carregado:', this.firestoreService.getFirestoreInstance());
               }

  //Verifica se o e-mail já está registrado no Firestore e envia recuperação de senha se necessário.
  checkIfEmailExists(email: string): Observable<void> {
    return from(this.firestoreService.checkIfEmailExists(email)).pipe(
      switchMap((emailExists) => {
        if (emailExists) {
          const auth = getAuth();
          return from(sendPasswordResetEmail(auth, email));
        }
        return of(void 0);
      }),
      catchError((error) => {
        this.globalErrorHandler.handleError(error);
        return throwError(() => new Error('Erro ao verificar e-mail.'));
      })
    );
  }

  //Registra um novo usuário.
   registerUser(userRegistrationData: IUserRegistrationData, password: string): Observable<UserCredential> {
    const nickname = userRegistrationData.nickname.trim();

    if (nickname.length < 4 || nickname.length > 24) {
      return throwError(() => new Error('Apelido deve ter entre 4 e 24 caracteres.'));
    }

    if (!this.isValidEmailFormat(userRegistrationData.email)) {
      return throwError(() => new Error('Formato de e-mail inválido.'));
    }

    // Agora chamando diretamente o serviço de validação otimizado:
    return this.firestoreValidation.checkIfNicknameExists(nickname).pipe(
      switchMap(nicknameExists => {
        if (nicknameExists) {
          return throwError(() => new Error('Apelido já está em uso.'));
        }

        return this.checkIfEmailExists(userRegistrationData.email);
      }),
      switchMap(() => createUserWithEmailAndPassword(getAuth(), userRegistrationData.email, password)),
      switchMap((userCredential) => {
        const user = userCredential.user;
        const userData: IUserRegistrationData = {
          ...userRegistrationData,
          uid: user.uid,
          firstLogin: Timestamp.fromDate(new Date()),
          emailVerified: false,
          registrationDate: new Date(),
        };

        return from(this.geolocationService.getCurrentLocation()).pipe(
          tap(location => {
            userData.latitude = location.latitude;
            userData.longitude = location.longitude;
          }),
          catchError((error) => {
            console.warn('⚠️ Erro ao obter localização:', error);
            return of(null);
          }),
          switchMap(() => this.firestoreService.saveInitialUserData(user.uid, userData)),
          switchMap(() => this.emailVerificationService.sendEmailVerification(user)),
          map(() => userCredential),
          catchError((error) => this.rollbackUser(user.uid, error))
        );
      }),
      catchError((error) => {
        this.globalErrorHandler.handleError(error);
        return throwError(() => error);
      })
    );
  }


  //Exclui um usuário antes da verificação, caso o registro falhe.
  private rollbackUser(uid: string, error: any): Observable<never> {
    return from(this.deleteUserOnFailure(uid)).pipe(
      switchMap(() => throwError(() => error)),
      catchError((rollbackError) => {
        this.globalErrorHandler.handleError(rollbackError);
        return throwError(() => error);
      })
    );
  }

  //Exclui o usuário criado no Firebase Auth em caso de falha.
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

  //Valida se a senha é forte o suficiente.
  isValidPassword(password: string): boolean {
    return ValidatorService.isValidPassword(password);
  }

   //Verifica se o formato do e-mail é válido.
  isValidEmailFormat(email: string): boolean {
    return ValidatorService.isValidEmail(email);
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
