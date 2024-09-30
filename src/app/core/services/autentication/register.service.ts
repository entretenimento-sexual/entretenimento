// src\app\core\services\autentication\register.service.ts
import { Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { EmailVerificationService } from './email-verification.service';
import { GeolocationService } from '../geolocation/geolocation.service';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';
import { UserCredential, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { catchError, from, Observable, of, tap } from 'rxjs';
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
  checkIfEmailExists(email: string): Observable<boolean> {
    // Converter o Promise para Observable
    return from(this.firestoreService.checkIfEmailExists(email));
  }

  // 3. Valida se o formato do e-mail é válido (ex: regex validation)
  isValidEmailFormat(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // 4. Registro de novo usuário
  async registerUser(userRegistrationData: IUserRegistrationData, password: string): Promise<UserCredential> {
    // 4.1. Verifica se o apelido já está em uso
    const nicknameExists = await this.checkIfNicknameExists(userRegistrationData.nickname);
    if (nicknameExists) {
      throw new Error('Apelido já está em uso.');
    }

    // 4.2. Verifica se o e-mail já está registrado
    const emailExists = await this.checkIfEmailExists(userRegistrationData.email).toPromise();
    if (emailExists) {
      throw new Error('E-mail já existe em nossos registros.');
    }

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
    userRegistrationData.emailVerified = false; // Padrão até que o e-mail seja verificado
    await this.firestoreService.saveInitialUserData(user.uid, userRegistrationData);

    // 4.6. Envia e-mail de verificação
    await this.emailVerificationService.sendEmailVerification(user);

    return userCredential;
  }

  // 5. Exclui um usuário antes da verificação se o registro falhar
  deleteUserOnFailure(uid: string): Observable<void> {
    const auth = getAuth();
    const user = auth.currentUser;

    // Verificar se o usuário existe e se o UID corresponde
    if (user && user.uid === uid) {
      // Retorna um Observable baseado na exclusão do usuário
      return from(user.delete().then(() => {
        console.log(`Usuário ${uid} deletado com sucesso.`);
      }));
    }

    // Retorna um Observable vazio, já que não há necessidade de excluir
    return of(void 0); // `void 0` é equivalente a `undefined`
  }

  // 6. Verifica se a senha é forte o suficiente
  isValidPassword(password: string): boolean {
    return ValidatorService.isValidPassword(password);
  }

  // 7. Reseta o status de tentativas de login em caso de erro
  resetLoginAttempts(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { loginAttempts: 0 });
  }

  // 8. Incrementa tentativas de login falhas
  incrementLoginAttempts(uid: string): Observable<void> {
    return this.firestoreService.incrementField('users', uid, 'loginAttempts', 1);
  }

  // 9. Bloqueia a conta temporariamente após muitas tentativas falhas
  lockAccount(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { accountLocked: true });
  }

  // 10. Desbloqueia uma conta manualmente após revisão
  unlockAccount(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { accountLocked: false });
  }

  // 11. Suspende um usuário (ex: por comportamento inadequado)
  suspendUser(uid: string, reason: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, {
      suspended: true,
      suspensionReason: reason,
      suspendedAt: Timestamp.fromDate(new Date())
    });
  }

  // 12. Remove a suspensão de um usuário
  unsuspendUser(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, {
      suspended: false,
      suspensionReason: null,
      suspendedAt: null
    });
  }

  // 13. Exclui uma conta de usuário permanentemente
  deleteUserAccount(uid: string): Observable<void> {
    // Remove os dados do Firestore
    return from(this.firestoreService.deleteDocument('users', uid)).pipe(
      // Remove o usuário do Firebase Authentication
      tap(() => {
        const auth = getAuth();
        const user = auth.currentUser;
        if (user && user.uid === uid) {
          user.delete();
        }
      })
    );
  }

  // 14. Confirmação de Termos de Uso e Política de Privacidade
  confirmTermsOfService(uid: string): Observable<void> {
    return this.firestoreService.updateDocument('users', uid, { termsAccepted: true });
  }

  // 15. Notifica sobre tentativas suspeitas de registro
  notifySuspiciousRegistrationAttempt(email: string, ip: string): void {
    console.warn(`Tentativa de registro suspeita detectada para o e-mail: ${email}, IP: ${ip}`);
    // Enviar notificação ao administrador, se necessário
  }
}
