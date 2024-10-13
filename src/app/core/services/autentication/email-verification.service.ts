// src\app\core\services\autentication\email-verification.service.ts
import { Injectable } from '@angular/core';
import { doc, setDoc, updateDoc, Timestamp } from '@firebase/firestore';
import { getAuth, User, sendEmailVerification, applyActionCode } from 'firebase/auth';
import { FirestoreService } from './firestore.service';
import { OobCodeService } from './oobCode.service';
import { IUserDados } from '../../interfaces/iuser-dados';

@Injectable({
  providedIn: 'root'
})
export class EmailVerificationService {
  constructor(
    private firestoreService: FirestoreService,
    private oobCodeService: OobCodeService
  ) { }

  // Recarrega o estado do usuário e verifica se o e-mail foi confirmado
  async reloadCurrentUser(): Promise<boolean> {
    const auth = getAuth();
    if (auth.currentUser) {
      await auth.currentUser.reload();
      return auth.currentUser?.emailVerified || false;
    }
    return false;
  }

  // Atualiza o status de verificação de e-mail no Firestore (mantendo booleano)
  async updateEmailVerificationStatus(uid: string, status: boolean): Promise<void> {
    const userRef = doc(this.firestoreService.db, "users", uid);
    await updateDoc(userRef, { emailVerified: status });
    console.log(`Status de verificação de e-mail atualizado para: ${status}`);
  }

   // Envia um e-mail de verificação para o usuário
  async sendEmailVerification(user: User): Promise<void> {
    const actionCodeSettings = { url: 'http://localhost:4200/email-verified' };
    await sendEmailVerification(user, actionCodeSettings);
  }

  // Verifica o e-mail usando o código de ação (oobCode)
  async verifyEmail(actionCode: string): Promise<void> {
    const auth = getAuth();
    await applyActionCode(auth, actionCode);
  }

  // Manipula a verificação de e-mail aplicando o código de ação
  async handleEmailVerification(): Promise<boolean> {
    const actionCode = this.oobCodeService.getCode();
    console.error('Nenhum oobCode encontrado.');
    if (!actionCode) return false;

    try {
      // Aplicar o código de ação para verificar o e-mail
      await applyActionCode(getAuth(), actionCode);

      // Verificar se o e-mail foi verificado
      const isEmailVerified = await this.reloadCurrentUser();

      if (isEmailVerified) {
        const currentUserUid = getAuth().currentUser?.uid;
        if (currentUserUid) {
          await this.updateEmailVerificationStatus(currentUserUid, true);
        }
      }

      return isEmailVerified;

    } catch (error: any) {
      // Captura os códigos de erro específicos e loga o erro
      if (error.code === 'auth/expired-action-code') {
        console.error('O código de verificação expirou.');
        throw new Error('O link de verificação expirou. Solicite um novo link de verificação.');
      } else if (error.code === 'auth/invalid-action-code') {
        console.error('O código de verificação é inválido.');
        throw new Error('O link de verificação é inválido. Verifique o link ou solicite um novo e-mail de verificação.');
      } else {
        console.error('Erro ao aplicar o código de verificação:', error);
        throw new Error('Ocorreu um erro inesperado ao verificar o e-mail. Tente novamente mais tarde.');
      }
    }
  }

  // Salva os dados do usuário após a verificação de e-mail
  async saveUserDataAfterEmailVerification(user: IUserDados): Promise<void> {
    try {
      if (!user.uid) throw new Error("UID do usuário não definido!");
      const userData = { ...user, role: user.role || 'basico', createdAt: Timestamp.fromDate(new Date()) };
      const userRef = doc(this.firestoreService.db, "users", user.uid);
      await setDoc(userRef, userData, { merge: true });
      console.log("Dados do usuário salvos após verificação de e-mail.");
    } catch (error) {
      console.error("Erro ao salvar os dados do usuário após verificação de e-mail:", error);
      throw error;
    }
  }

  // Reenvia o e-mail de verificação para o usuário atual
  async resendVerificationEmail(): Promise<void> {
    const currentUser = getAuth().currentUser;
    if (currentUser) {
      await this.sendEmailVerification(currentUser);
    } else {
      throw new Error('Nenhum usuário autenticado encontrado');
    }
  }

  // Método para obter o UID do usuário atual
  getCurrentUserUid(): string | null {
    const auth = getAuth();
    return auth.currentUser ? auth.currentUser.uid : null;
  }
}
