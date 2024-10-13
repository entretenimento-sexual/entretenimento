// src\app\core\services\autentication\email-input-modal.service.ts
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { LoginService } from '../autentication/login.service';

@Injectable({
  providedIn: 'root'
})
export class EmailInputModalService {
  public isModalOpen: Subject<boolean> = new Subject<boolean>();
  public emailSentMessage: Subject<string> = new Subject<string>();


  constructor(private loginService: LoginService) { }

  // Abre o modal
  openModal(): void {
    this.isModalOpen.next(true);
  }

  // Fecha o modal
  closeModal(): void {
    this.isModalOpen.next(false);
  }

  // Envia o e-mail de recuperação de senha
  sendPasswordRecoveryEmail(email: string): void {
    if (!email) {
      this.emailSentMessage.next('Por favor, insira um e-mail válido.');
      return;
    }

    this.loginService.sendPasswordResetEmail(email)
      .then(() => {
        this.emailSentMessage.next('E-mail de recuperação de senha enviado com sucesso!');
        this.closeModal();
      })
      .catch(() => {
        this.emailSentMessage.next('Falha ao enviar o e-mail de recuperação de senha.');
      });
  }
}
