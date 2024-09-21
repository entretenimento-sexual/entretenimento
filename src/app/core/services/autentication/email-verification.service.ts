// src\app\core\services\autentication\email-verification.service.ts
import { Injectable } from '@angular/core';
import { doc, updateDoc } from '@firebase/firestore';
import { getAuth, User, sendEmailVerification, applyActionCode } from 'firebase/auth';
import { FirestoreService } from './firestore.service';
import { OobCodeService } from './oobCode.service';

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

  // Atualiza o status de verificação de e-mail no Firestore
  async updateEmailVerificationStatus(uid: string, isVerified: boolean): Promise<void> {
    const userRef = doc(this.firestoreService.db, "users", uid);
    await updateDoc(userRef, { emailVerified: isVerified });
    console.log("Status de verificação de e-mail atualizado no Firestore.");
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
    if (!actionCode) return false;

    try {
      await applyActionCode(getAuth(), actionCode);
      const isEmailVerified = await this.reloadCurrentUser();

      if (isEmailVerified) {
        const currentUserUid = getAuth().currentUser?.uid;
        if (currentUserUid) {
          await this.updateEmailVerificationStatus(currentUserUid, true);
        }
      }
      return isEmailVerified;

    } catch (error) {
      console.error('Erro ao aplicar o código de ação:', error);
      return false;
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
}
