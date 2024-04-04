// oobCode.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class OobCodeService {
  private code: string | null = null;

  setCode(code: string): void {
    console.log('Definindo oobCode:', code); // Log quando o código é definido
    this.code = code;
  }

  getCode(): string | null {
    console.log('Recuperando oobCode:', this.code); // Log quando o código é obtido
    return this.code;
  }
}
