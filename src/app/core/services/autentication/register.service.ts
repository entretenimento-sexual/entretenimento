// src\app\core\services\autentication\register.service.ts
import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { EmailVerificationService } from './email-verification.service';
import { GeolocationService } from '../geolocation/geolocation.service';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';
import { UserCredential, createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail } from 'firebase/auth'; // Aqui está a importação correta
import { Timestamp } from 'firebase/firestore';
import { from, Observable, of, tap } from 'rxjs';
import { ValidatorService } from '../data-handling/validator.service';

@Injectable({
  providedIn: 'root'
})
export class RegisterService {

  constructor(
    private firestoreService: FirestoreService,
    private emailVerificationService: EmailVerificationService,
    private geolocationService: GeolocationService
  ) { }

  // 1. Verifica se o apelido já existe no Firestore
  checkIfNicknameExists(nickname: string): Promise<boolean> {
    return this.firestoreService.checkIfNicknameExists(nickname);
  }

  // 2. Verifica se o e-mail já está registrado no Firestore
  async checkIfEmailExists(email: string): Promise<void> {
    const emailExists = await this.firestoreService.checkIfEmailExists(email);

    if (emailExists) {
      // Agora, usando a função correta para enviar o e-mail de recuperação
      const auth = getAuth();
      await sendPasswordResetEmail(auth, email);
    }
  }

  // 3. Valida se o formato do e-mail é válido (usando o ValidatorService)
  isValidEmailFormat(email: string): boolean {
    return ValidatorService.isValidEmail(email);
  }

  // 4. Registro de novo usuário
  async registerUser(userRegistrationData: IUserRegistrationData, password: string): Promise<UserCredential> {
    // 4.1. Verifica se o apelido já está em uso
    const nicknameExists = await this.checkIfNicknameExists(userRegistrationData.nickname);
    if (nicknameExists) {
      throw new Error('Apelido já está em uso.');
    }

    // 4.2. Verifica se o e-mail já está registrado
    await this.checkIfEmailExists(userRegistrationData.email);

    // 4.3. Criação do usuário com o Firebase Auth
    const auth = getAuth();
    const userCredential = await createUserWithEmailAndPassword(auth, userRegistrationData.email, password);
    const user = userCredential.user;

    // 4.4. Captura da geolocalização (opcional)
    try {
      const location = await this.geolocationService.getCurrentLocation();
      userRegistrationData.latitude = location.latitude;
      userRegistrationData.longitude = location.longitude;
    } catch (error) {
      console.warn('Erro ao obter localização:', error);
    }

    // 4.5. Salva os dados do usuário no Firestore
    userRegistrationData.uid = user.uid;
    userRegistrationData.firstLogin = Timestamp.fromDate(new Date());
    userRegistrationData.emailVerified = false;
    await this.firestoreService.saveInitialUserData(user.uid, userRegistrationData);

    // 4.6. Envia e-mail de verificação
    await this.emailVerificationService.sendEmailVerification(user);

    return userCredential;
  } catch(error: any) {
    // Aqui verificamos especificamente se o erro é de e-mail já em uso
    if (error.code === 'auth/email-already-in-use') {
      throw new Error('auth/email-already-in-use');
    }
    throw error; // Repassa outros erros inesperados
  }


  // 5. Exclui um usuário antes da verificação se o registro falhar
  deleteUserOnFailure(uid: string): Observable<void> {
    const auth = getAuth();
    const user = auth.currentUser;

    // Verificar se o usuário existe e se o UID corresponde
    if (user && user.uid === uid) {
      return from(user.delete().then(() => {
        console.log(`Usuário ${uid} deletado com sucesso.`);
      }));
    }
    return of(void 0);
  }

  // 6. Verifica se a senha é forte o suficiente (usando o ValidatorService)
  isValidPassword(password: string): boolean {
    return ValidatorService.isValidPassword(password);
  }
}
