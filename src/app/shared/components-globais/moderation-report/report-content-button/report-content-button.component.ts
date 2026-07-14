// src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component.ts
// -----------------------------------------------------------------------------
// REPORT CONTENT BUTTON
// -----------------------------------------------------------------------------
// Botão reutilizável para abrir o fluxo de denúncia.
//
// Decisões:
// - recebe apenas identificadores mínimos do alvo;
// - usa MatDialog para foco acessível;
// - envia via ModerationReportService;
// - feedback centralizado por ErrorNotificationService;
// - mantém API simples para perfil, mídia e interações sociais.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { EMPTY } from 'rxjs';
import { catchError, filter, finalize, switchMap, take } from 'rxjs/operators';

import { SharedMaterialModule } from 'src/app/shared/shared-material.module';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ModerationReportService } from 'src/app/core/services/moderation/moderation-report.service';
import { ModerationReportTargetType } from 'src/app/core/interfaces/moderation/moderation-report.interface';
import {
  ReportContentDialogComponent,
  ReportContentDialogResult,
} from '../report-content-dialog/report-content-dialog.component';

@Component({
  selector: 'app-report-content-button',
  standalone: true,
  imports: [CommonModule, SharedMaterialModule],
  templateUrl: './report-content-button.component.html',
  styleUrls: ['./report-content-button.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportContentButtonComponent {
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly reportService = inject(ModerationReportService);
  private readonly notification = inject(ErrorNotificationService);

  readonly submitting = signal(false);

  @Input({ required: true }) targetType!: ModerationReportTargetType;
  @Input({ required: true }) targetId!: string;
  @Input() parentTargetId: string | null = null;
  @Input() targetOwnerUid: string | null = null;
  @Input() targetAuthorUid: string | null = null;
  @Input() label = 'Denunciar';
  @Input() title: string | null = null;
  @Input() subtitle: string | null = null;
  @Input() appearance: 'button' | 'icon' | 'link' = 'button';
  @Input() disabled = false;

  openReportDialog(): void {
    const targetId = String(this.targetId ?? '').trim();

    if (!targetId || this.disabled || this.submitting()) {
      return;
    }

    const dialogRef = this.dialog.open<
      ReportContentDialogComponent,
      {
        targetType: ModerationReportTargetType;
        title: string | null;
        subtitle: string | null;
      },
      ReportContentDialogResult | null
    >(ReportContentDialogComponent, {
      width: 'min(92vw, 560px)',
      maxWidth: '96vw',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      data: {
        targetType: this.targetType,
        title: this.title,
        subtitle: this.subtitle,
      },
    });

    dialogRef.afterClosed().pipe(
      take(1),
      filter((result): result is ReportContentDialogResult => !!result),
      switchMap((result) => {
        this.submitting.set(true);

        return this.reportService.createReport$({
          targetType: this.targetType,
          targetId,
          parentTargetId: this.normalizeOptionalText(this.parentTargetId),
          targetOwnerUid: this.normalizeOptionalText(this.targetOwnerUid),
          targetAuthorUid: this.normalizeOptionalText(this.targetAuthorUid),
          reason: result.reason,
          details: result.details,
          route: this.currentRoute(),
        }).pipe(
          finalize(() => this.submitting.set(false)),
          catchError((error) => {
            this.notification.showError(
              'Não foi possível enviar a denúncia. Tente novamente.',
              error instanceof Error ? error.message : undefined
            );
            return EMPTY;
          })
        );
      })
    ).subscribe({
      next: () => {
        this.notification.showSuccess('Denúncia enviada para análise.');
      },
    });
  }

  get ariaLabel(): string {
    const target = this.title?.trim() ||
      this.resolveTargetLabel(this.targetType);
    return `Denunciar ${target}`;
  }

  private currentRoute(): string {
    return String(this.router.url ?? '').trim().slice(0, 300) || '/';
  }

  private normalizeOptionalText(
    value: string | null | undefined
  ): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private resolveTargetLabel(type: ModerationReportTargetType): string {
    switch (type) {
      case 'profile':
        return 'perfil';
      case 'photo':
        return 'foto';
      case 'video':
        return 'vídeo';
      case 'video_comment':
        return 'comentário do vídeo';
      case 'video_rating':
        return 'avaliação do vídeo';
      case 'message':
        return 'mensagem';
      case 'room':
        return 'sala';
      case 'status':
        return 'Status de Hoje';
      case 'venue':
        return 'local';
      case 'other':
      default:
        return 'conteúdo';
    }
  }
}
