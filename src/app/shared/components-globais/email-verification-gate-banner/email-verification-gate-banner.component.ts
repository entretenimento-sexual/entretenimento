//src\app\shared\components-globais\email-verification-gate-banner\email-verification-gate-banner.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { EmailVerificationGateFacade } from 'src/app/core/services/autentication/auth/email-verification-gate.facade';

@Component({
  selector: 'app-email-verification-gate-banner',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './email-verification-gate-banner.component.html',
  styleUrl: './email-verification-gate-banner.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailVerificationGateBannerComponent {
  readonly facade = inject(EmailVerificationGateFacade);
  readonly vm$ = this.facade.vm$;

  resend(): void {
    this.facade.resend();
  }
}