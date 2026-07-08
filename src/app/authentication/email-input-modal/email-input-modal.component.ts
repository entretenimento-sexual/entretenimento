// src/app/authentication/email-input-modal/email-input-modal.component.ts
import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';

@Component({
  selector: 'app-email-input-modal',
  templateUrl: './email-input-modal.component.html',
  styleUrls: ['./email-input-modal.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [AsyncPipe, FormsModule],
})
export class EmailInputModalComponent {
  readonly vm$ = this.emailInputModalService.state$;

  constructor(private readonly emailInputModalService: EmailInputModalService) {}

  updateEmail(email: string): void {
    this.emailInputModalService.updateEmail(email);
  }

  sendEmail(email: string): void {
    this.emailInputModalService.sendPasswordRecoveryEmail(email);
  }

  closeModal(): void {
    this.emailInputModalService.closeModal();
  }
}
