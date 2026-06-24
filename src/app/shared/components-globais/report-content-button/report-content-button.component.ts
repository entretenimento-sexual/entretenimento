// src/app/shared/components-globais/report-content-button/report-content-button.component.ts
// -----------------------------------------------------------------------------
// REPORT CONTENT BUTTON
// -----------------------------------------------------------------------------
// Botão/formulário reutilizável para denúncia de conteúdo ou perfil.
//
// Decisões:
// - standalone e exportável pelo SharedModule;
// - usa ModerationReportService como único canal de escrita;
// - feedback centralizado via ErrorNotificationService;
// - não expõe fila administrativa nem dados de outras denúncias;
// - usa formulário compacto, acessível e mobile-first.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, take } from 'rxjs/operators';

import {
  ModerationReportReason,
  ModerationReportTargetType,
} from 'src/app/core/interfaces/moderation/moderation-report.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ModerationReportService } from 'src/app/core/services/moderation/moderation-report.service';

interface ReportReasonOption {
  readonly value: ModerationReportReason;
  readonly label: string;
}

@Component({
  selector: 'app-report-content-button',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report-content-button.component.html',
  styleUrls: ['./report-content-button.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportContentButtonComponent {
  private readonly reports = inject(ModerationReportService);
  private readonly notifier = inject(ErrorNotificationService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  @Input() targetType: ModerationReportTargetType = 'other';
  @Input() targetId = '';
  @Input() targetOwnerUid: string | null = null;
  @Input() contextLabel = 'este conteúdo';
  @Input() buttonLabel = 'Denunciar';

  isOpen = false;
  isSubmitting = false;
  reason: ModerationReportReason | '' = '';
  details = '';

  readonly reasonOptions: ReportReasonOption[] = [
    { value: 'fake_profile', label: 'Perfil falso ou suspeito' },
    { value: 'harassment', label: 'Assédio ou importunação' },
    { value: 'hate_or_abuse', label: 'Ofensa, ameaça ou abuso' },
    { value: 'sexual_boundary', label: 'Conduta sexual inadequada' },
    { value: 'privacy', label: 'Privacidade ou exposição indevida' },
    { value: 'spam', label: 'Spam ou golpe' },
    { value: 'minor_safety', label: 'Suspeita envolvendo menor de idade' },
    { value: 'illegal_content', label: 'Conteúdo ilegal' },
    { value: 'other', label: 'Outro motivo' },
  ];

  get canReport(): boolean {
    return !!String(this.targetId ?? '').trim();
  }

  toggle(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    if (!this.canReport || this.isSubmitting) {
      return;
    }

    this.isOpen = !this.isOpen;
    this.cdr.markForCheck();
  }

  close(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    if (this.isSubmitting) {
      return;
    }

    this.isOpen = false;
    this.cdr.markForCheck();
  }

  submit(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    const targetId = String(this.targetId ?? '').trim();
    const reason = String(this.reason ?? '').trim() as ModerationReportReason;

    if (!targetId) {
      this.notifier.showWarning('Não foi possível identificar o item denunciado.');
      return;
    }

    if (!reason) {
      this.notifier.showWarning('Selecione um motivo para a denúncia.');
      return;
    }

    if (this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;
    this.cdr.markForCheck();

    this.reports.createReport$({
      targetType: this.targetType,
      targetId,
      targetOwnerUid: String(this.targetOwnerUid ?? '').trim() || null,
      reason,
      details: this.details,
      route: this.router.url,
    }).pipe(
      take(1),
      finalize(() => {
        this.isSubmitting = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: () => {
        this.notifier.showSuccess('Denúncia enviada. Obrigado por ajudar a manter a comunidade segura.');
        this.resetForm();
      },
      error: () => {
        this.notifier.showError('Não foi possível enviar a denúncia. Tente novamente.');
      },
    });
  }

  private resetForm(): void {
    this.isOpen = false;
    this.reason = '';
    this.details = '';
    this.cdr.markForCheck();
  }
}
