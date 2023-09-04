// src\app\core\services\autentication\email-verification.service.ts
import { Injectable } from '@angular/core';
import { getAuth } from 'firebase/auth';

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
    console.log('Definindo oobCode:', code); // Log quando o código é definido
    this.code = code;
  }

  getCode(): string | null {
    console.log('Recuperando oobCode:', this.code); // Log quando o código é obtido
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
}
