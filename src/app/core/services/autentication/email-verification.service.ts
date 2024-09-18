// src\app\core\services\autentication\email-verification.service.ts
import { Injectable } from '@angular/core';
import { doc, updateDoc } from '@firebase/firestore';
import { getAuth, User, sendEmailVerification, applyActionCode } from 'firebase/auth';
import { FirestoreService } from './firestore.service';
import { OobCodeService } from './oobCode.service'; // Importa o OobCodeService

@Injectable({
  providedIn: 'root'
})
export class EmailVerificationService {

  constructor(
    private firestoreService: FirestoreService,
    private oobCodeService: OobCodeService // Injeta o OobCodeService para manipular o oobCode
  ) {
    console.log("Construtor do EmailVerificationService foi chamado");
  }

  /**
   * Recarga o estado do usuário e verifica se o e-mail foi confirmado
   * @returns {Promise<boolean>} true se o e-mail foi verificado, false se não
   */
  async reloadCurrentUser(): Promise<boolean> {
    console.log("Método reloadCurrentUser foi chamado");
    const auth = getAuth();
    if (auth.currentUser) {
      await auth.currentUser.reload(); // Atualiza o estado do usuário autenticado
      console.log("Usuário recarregado");
      return auth.currentUser?.emailVerified || false; // Retorna true se o e-mail foi verificado
    }
    console.log("Nenhum usuário atual encontrado");
    return false; // Caso não tenha usuário autenticado
  }

  /**
   * Atualiza o status de verificação de e-mail no Firestore
   * @param {string} uid - ID do usuário no Firestore
   * @param {boolean} isVerified - Status de verificação de e-mail
   * @returns {Promise<void>}
   */
  async updateEmailVerificationStatus(uid: string, isVerified: boolean): Promise<void> {
    const userRef = doc(this.firestoreService.db, "users", uid);
    await updateDoc(userRef, {
      emailVerified: isVerified
    });
    console.log("Status de verificação de e-mail atualizado no Firestore.");
  }

  /**
   * Envia um e-mail de verificação para o usuário
   * @param {User} user - Usuário autenticado
   * @returns {Promise<void>}
   */
  async sendEmailVerification(user: User): Promise<void> {
    const actionCodeSettings = {
      url: 'http://localhost:4200/email-verified', // URL de redirecionamento após a verificação
    };
    await sendEmailVerification(user, actionCodeSettings); // Envia o e-mail com as configurações fornecidas
  }

  /**
   * Verifica o e-mail usando o código de ação (oobCode)
   * @param {string} actionCode - Código de ação de verificação de e-mail
   * @returns {Promise<void>}
   */
  async verifyEmail(actionCode: string): Promise<void> {
    const auth = getAuth();
    return await applyActionCode(auth, actionCode); // Aplica o código de verificação
  }

  /**
   * Manipula a verificação de e-mail, aplicando o código de ação
   * @returns {Promise<boolean>} true se a verificação foi bem-sucedida, false se não
   */
  async handleEmailVerification(): Promise<boolean> {
    const actionCode = this.oobCodeService.getCode(); // Obtém o oobCode do OobCodeService
    if (!actionCode) {
      console.error("ActionCode não fornecido.");
      return false;
    }
    console.log("ActionCode recebido:", actionCode);

    try {
      await applyActionCode(getAuth(), actionCode); // Aplica o código de ação
      console.log('A verificação do e-mail foi bem-sucedida.');

      const isEmailReloadedAndVerified = await this.reloadCurrentUser(); // Recarrega o estado do usuário

      if (isEmailReloadedAndVerified) {
        const currentUserUid = getAuth().currentUser?.uid; // Obtém o UID do usuário atual
        if (currentUserUid) {
          await this.firestoreService.updateEmailVerificationStatus(currentUserUid, true); // Atualiza o status no Firestore
        }
      }
      return isEmailReloadedAndVerified;

    } catch (error) {
      console.error('Erro ao aplicar o código de ação:', error);
      return false;
    }
  }

  /**
   * Reenvia o e-mail de verificação para o usuário atual
   * @returns {Promise<void>}
   */
  async resendVerificationEmail(): Promise<void> {
    const currentUser = getAuth().currentUser;
    if (currentUser) {
      await this.sendEmailVerification(currentUser); // Reenvia o e-mail de verificação
    } else {
      throw new Error('Nenhum usuário autenticado encontrado');
    }
  }
}
