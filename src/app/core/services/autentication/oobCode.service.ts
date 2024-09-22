// src\app\core\services\autentication\oobCode.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class OobCodeService {
  private code: string | null = null; // Armazena o código de verificação (oobCode)

  /**
   * Define o código de verificação de e-mail (oobCode)
   * @param {string} code - Código de verificação
   */
  setCode(code: string): void {
    console.log('Definindo oobCode:', code); // Log quando o código é definido
    this.code = code; // Armazena o código
  }

  /**
   * Recupera o código de verificação de e-mail (oobCode)
   * @returns {string | null} - Código de verificação ou null se não estiver definido
   */
  getCode(): string | null {
    console.log('Recuperando oobCode:', this.code); // Log quando o código é obtido
    return this.code; // Retorna o código armazenado
  }
}
