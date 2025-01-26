// src/app/core/services/autentication/register.service.ts
import { Injectable } from '@angular/core';
import { UserCredential, createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, map, tap } from 'rxjs/operators';
import { FirestoreService } from '../../data-handling/firestore.service';
import { EmailVerificationService } from './email-verification.service';
import { GeolocationService } from '../../geolocation/geolocation.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreUserQueryService } from '../../data-handling/firestore-user-query.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { ValidatorService } from '../../general/validator.service';

@Injectable({
  providedIn: 'root',
})
export class RegisterService {
  constructor(
    private firestoreService: FirestoreService,
    private emailVerificationService: EmailVerificationService,
    private geolocationService: GeolocationService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private firestoreUserQuery: FirestoreUserQueryService
  ) { }

  /**
   * Verifica se o apelido já existe no Firestore.
   */
  checkIfNicknameExists(nickname: string): Observable<boolean> {
    return from(this.firestoreService.checkIfNicknameExists(nickname)).pipe(
      catchError((error) => {
        this.globalErrorHandler.handleError(error);
        return throwError(() => new Error('Erro ao verificar apelido.'));
      })
    );
  }

  /**
   * Verifica se o e-mail já está registrado no Firestore e envia recuperação de senha se necessário.
   */
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

  /**
   * Registra um novo usuário.
   */
  registerUser(userRegistrationData: IUserRegistrationData, password: string): Observable<UserCredential> {
    console.log('Iniciando o processo de registro no serviço. Dados recebidos:', userRegistrationData);

    const apelidoPrincipal = userRegistrationData.nickname.split(' ')[0].trim();
    const complementoApelido = userRegistrationData.nickname.split(' ').slice(1).join(' ').trim();
    const nickname = `${apelidoPrincipal} ${complementoApelido}`.trim();

    if (nickname.length < 4 || nickname.length > 24) {
      console.error('Apelido inválido:', nickname);
      return throwError(() => new Error('Apelido deve ter entre 4 e 24 caracteres.'));
    }

    userRegistrationData.nickname = nickname;

    if (userRegistrationData.municipio && userRegistrationData.estado) {
      userRegistrationData.municipioEstado = `${userRegistrationData.municipio} - ${userRegistrationData.estado}`;
    }

    console.log('Validando apelido:', nickname);

    return this.checkIfNicknameExists(nickname).pipe(
      tap((exists) => console.log(`Resultado da validação do apelido "${nickname}":`, exists)),
      switchMap((exists) => {
        if (exists) {
          console.error('Apelido já está em uso:', nickname);
          return throwError(() => new Error('Apelido já está em uso.'));
        }
        console.log('Apelido válido. Validando e-mail:', userRegistrationData.email);
        return this.checkIfEmailExists(userRegistrationData.email);
      }),
      switchMap(() => {
        const auth = getAuth();
        console.log('Criando usuário no Firebase Authentication...');
        return from(createUserWithEmailAndPassword(auth, userRegistrationData.email, password));
      }),
      tap((userCredential) => console.log('Usuário criado no Firebase Authentication:', userCredential)),
      switchMap((userCredential) => {
        const user = userCredential.user;
        userRegistrationData.uid = user.uid;
        userRegistrationData.firstLogin = Timestamp.fromDate(new Date());
        userRegistrationData.emailVerified = false;
        userRegistrationData.registrationDate = new Date();

        console.log('Capturando localização...');
        return from(this.geolocationService.getCurrentLocation()).pipe(
          map((location) => {
            userRegistrationData.latitude = location.latitude;
            userRegistrationData.longitude = location.longitude;
          }),
          catchError((error) => {
            console.warn('Erro ao capturar localização:', error);
            return of(void 0);
          }),
          switchMap(() => {
            console.log('Salvando dados iniciais do usuário no Firestore...');
            return from(this.firestoreService.saveInitialUserData(user.uid, userRegistrationData));
          }),
          switchMap(() => {
            console.log('Enviando e-mail de verificação...');
            return from(this.emailVerificationService.sendEmailVerification(user));
          }),
          map(() => userCredential),
          catchError((error) => {
            console.error('Erro no fluxo de registro. Iniciando rollback:', error);
            return this.rollbackUser(user.uid, error);
          })
        );
      }),
      catchError((error) => {
        console.error('Erro geral no registro:', error);
        return throwError(() => error);
      })
    );
  }


  /**
   * Exclui um usuário antes da verificação, caso o registro falhe.
   */
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
