// src\app\shared\email-input-modal\email-input-modal.component.ts
import { Component, OnInit } from '@angular/core';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';

@Component({
  selector: 'app-email-input-modal',
  templateUrl: './email-input-modal.component.html',
  styleUrls: ['./email-input-modal.component.css']
})
export class EmailInputModalComponent implements OnInit {
  public email: string = '';
  public message: string = '';
  public isModalOpen: boolean = false;

  constructor(
    private emailInputModalService: EmailInputModalService)
  { }

  ngOnInit(): void {
    this.emailInputModalService.isModalOpen.subscribe(isOpen => {
      this.isModalOpen = isOpen;
    });

    this.emailInputModalService.emailSentMessage.subscribe(message => {
      this.message = message;
    });
  }

  // Envia o e-mail de recuperação de senha
  sendEmail(): void {
    this.emailInputModalService.sendPasswordRecoveryEmail(this.email);
  }

  // Fecha o modal
  closeModal(): void {
    this.emailInputModalService.closeModal();
  }
}
