//src\app\core\services\error-handler\error-notification.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ErrorNotificationService {
  showError(message: string): void {
    // Implemente aqui a lógica para exibir uma mensagem de erro ao usuário
    // Pode ser um toast, modal, etc.
    alert(message); // Simples alerta para exemplo
  }
}

