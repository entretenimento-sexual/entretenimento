// src\app\core\services\autentication\email-verification.service.ts
import { Injectable } from '@angular/core';
import { getAuth, User, sendEmailVerification, applyActionCode } from 'firebase/auth';

@Injectable({
  providedIn: 'root'
})
export class EmailVerificationService {

  private code: string | null = null;

  constructor() {
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
  updateEmailVerificationStatus(isVerified: boolean): void {
    console.log("Atualizando o status de verificação de email para:", isVerified);
    // Aqui, adicione sua lógica para atualizar o campo emailVerified no Firestore
  }

  async sendEmailVerification(user: User, settings: any): Promise<void> {
    await sendEmailVerification(user, settings);
    console.log('E-mail de verificação enviado:', user);
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
      } else {
        console.error("Erro ao recarregar o estado de verificação do e-mail do usuário.");
      }

      return isEmailReloadedAndVerified;

    } catch (error) {
      console.error('Erro ao aplicar o código de ação:', error);
      return false;
    }
  }

}
