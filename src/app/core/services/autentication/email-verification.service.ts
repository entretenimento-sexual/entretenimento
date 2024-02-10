// src\app\core\services\autentication\email-verification.service.ts
import { Injectable } from '@angular/core';
import { doc, updateDoc } from '@firebase/firestore';
import { getAuth, User, sendEmailVerification, applyActionCode } from 'firebase/auth';
import { FirestoreService } from './firestore.service';

@Injectable({
  providedIn: 'root'
})

export class EmailVerificationService {
  private code: string | null = null;

  constructor(private firestoreService: FirestoreService) {
    console.log("Construtor do EmailVerificationService foi chamado");
  }

  // Métodos relacionados ao oobCode
  setCode(code: string): void {
    console.log('Definindo oobCode:', code);
    this.code = code;
  }

  getCode(): string | null {
    console.log('Recuperando oobCode:', this.code);
    return this.code;
  }

  // Método para recarregar o usuário atual e retornar o estado de verificação do e-mail
  async reloadCurrentUser(): Promise<boolean> {
    console.log("Método reloadCurrentUser foi chamado");
    const auth = getAuth();
    if (auth.currentUser) {
      await auth.currentUser.reload();
      console.log("Usuário recarregado");
      return auth.currentUser?.emailVerified || false;
    }
    console.log("Nenhum usuário atual encontrado");
    return false;
  }

  // Método para atualizar o status de verificação de e-mail no Firestore (se necessário)
  async updateEmailVerificationStatus(uid: string, isVerified: boolean): Promise<void> {
    const userRef = doc(this.firestoreService.db, "users", uid);
    await updateDoc(userRef, {
      emailVerified: isVerified
    });
    console.log("Status de verificação de e-mail atualizado no Firestore.");
  }

  async sendEmailVerification(user: User): Promise<void> {
    const actionCodeSettings = {
      url: 'http://localhost:4200/email-verified',
      // Adicione outras configurações necessárias aqui
    };
    await sendEmailVerification(user, actionCodeSettings);
  }

  async verifyEmail(actionCode: string): Promise<void> {
    const auth = getAuth();
    return await applyActionCode(auth, actionCode);
  }


  async handleEmailVerification(actionCode: string): Promise<boolean> {
    if (!actionCode) {
      console.error("ActionCode não fornecido.");
      return false;
    }
    console.log("ActionCode recebido:", actionCode);

    try {
      await applyActionCode(getAuth(), actionCode);
      console.log('A verificação do e-mail foi bem-sucedida.');

      const isEmailReloadedAndVerified = await this.reloadCurrentUser();

      if (isEmailReloadedAndVerified) {
        console.log("Estado de verificação do e-mail do usuário recarregado com sucesso.");

        // Obtenha o UID do usuário atual
        const currentUserUid = getAuth().currentUser?.uid;
        if (currentUserUid) {
          // Atualize o status de verificação de e-mail no Firestore
          await this.firestoreService.updateEmailVerificationStatus(currentUserUid, true);
        }
      }
      return isEmailReloadedAndVerified;

    } catch (error) {
      console.error('Erro ao aplicar o código de ação:', error);
      return false;
    }
  }
}
