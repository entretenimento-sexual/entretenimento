import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';
import { finalize } from 'rxjs/operators';

import { AdminMaterialModule } from '../admin-material.module';
import {
  AdminModerationReportService,
  AdminModerationReportVm,
} from 'src/app/core/services/moderation/admin-moderation-report.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-profile-age-reverification-admin-actions',
  standalone: true,
  imports: [CommonModule, AdminMaterialModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="age-review-actions" aria-label="Ações de revalidação de idade">
      @if (!report.ageReverificationStatus) {
        <p>
          Esta denúncia ainda não restringiu a conta. Solicite revalidação somente
          quando houver indícios suficientes de que a pessoa do perfil pode ser menor.
        </p>
        <div class="age-review-actions__buttons">
          <button
            mat-flat-button
            type="button"
            color="primary"
            (click)="requestReverification()"
            [disabled]="busy()"
          >
            {{ busy() ? 'Atualizando...' : 'Solicitar revalidação de idade' }}
          </button>
          <button
            mat-stroked-button
            type="button"
            color="warn"
            (click)="rejectReport()"
            [disabled]="busy()"
          >
            Rejeitar denúncia
          </button>
        </div>
      } @else if (
        report.ageReverificationStatus === 'REQUIRED'
      ) {
        <p role="status">
          A revalidação foi solicitada. A conta está limitada e aguarda o envio do usuário.
        </p>
      } @else if (
        report.ageReverificationStatus === 'SUBMITTED' ||
        report.ageReverificationStatus === 'UNDER_REVIEW'
      ) {
        <p role="status">
          O usuário enviou a declaração para análise. Registre uma nota objetiva antes da decisão.
        </p>
        <div class="age-review-actions__buttons">
          <button
            mat-flat-button
            type="button"
            color="primary"
            (click)="reviewReverification('VERIFY')"
            [disabled]="busy()"
          >
            {{ busy() ? 'Atualizando...' : 'Confirmar maioridade' }}
          </button>
          <button
            mat-stroked-button
            type="button"
            color="warn"
            (click)="reviewReverification('REJECT')"
            [disabled]="busy()"
          >
            Confirmar menoridade
          </button>
        </div>
      } @else {
        <p role="status">
          Revalidação encerrada: <strong>{{ statusLabel }}</strong>.
        </p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .age-review-actions {
      display: grid;
      gap: .8rem;
      padding: 1rem;
      border: 1px solid rgba(124, 92, 255, .35);
      border-radius: .85rem;
      background: rgba(124, 92, 255, .07);
    }
    .age-review-actions p { margin: 0; line-height: 1.5; }
    .age-review-actions__buttons {
      display: flex;
      flex-wrap: wrap;
      gap: .75rem;
    }
    @media (max-width: 40rem) {
      .age-review-actions__buttons { display: grid; }
      .age-review-actions__buttons button { width: 100%; }
    }
  `],
})
export class ProfileAgeReverificationAdminActionsComponent {
  private readonly reportsService = inject(AdminModerationReportService);
  private readonly notification = inject(ErrorNotificationService);

  readonly busy = signal(false);

  @Input({ required: true }) report!: AdminModerationReportVm;
  @Input() resolution = '';

  get statusLabel(): string {
    switch (this.report?.ageReverificationStatus) {
      case 'VERIFIED':
        return 'maioridade confirmada';
      case 'REJECTED':
        return 'menoridade confirmada';
      case 'EXPIRED':
        return 'prazo expirado';
      default:
        return 'encerrada';
    }
  }

  requestReverification(): void {
    const resolution = this.resolvedNote(
      'Revalidação solicitada após análise de denúncia de perfil por possível menoridade.'
    );

    this.execute(
      this.reportsService.requestProfileAgeReverification$(
        this.report.id,
        resolution
      ),
      'Revalidação solicitada. O perfil foi ocultado e as interações foram limitadas.'
    );
  }

  rejectReport(): void {
    const resolution = this.resolvedNote(
      'Denúncia rejeitada por ausência de indícios suficientes de menoridade.'
    );

    this.execute(
      this.reportsService.rejectProfileMinorSafetyReport$(
        this.report.id,
        resolution
      ),
      'Denúncia rejeitada sem alterar a conta.'
    );
  }

  reviewReverification(decision: 'VERIFY' | 'REJECT'): void {
    const fallback = decision === 'VERIFY'
      ? 'Maioridade confirmada após revisão administrativa do caso.'
      : 'Menoridade confirmada após revisão administrativa do caso.';
    const resolution = this.resolvedNote(fallback);

    this.execute(
      this.reportsService.reviewProfileAgeReverification$(
        this.report.id,
        decision,
        resolution
      ),
      decision === 'VERIFY'
        ? 'Maioridade confirmada e restrição de idade encerrada.'
        : 'Menoridade confirmada e conta suspensa pela moderação.'
    );
  }

  private execute(operation$: ReturnType<
    AdminModerationReportService['requestProfileAgeReverification$']
  >, successMessage: string): void {
    if (this.busy() || !this.report?.id) {
      return;
    }

    this.busy.set(true);

    operation$
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => this.notification.showSuccess(successMessage),
        error: () => this.notification.showError(
          'Não foi possível concluir a ação de revalidação.'
        ),
      });
  }

  private resolvedNote(fallback: string): string {
    return String(this.resolution ?? '').trim().slice(0, 900) || fallback;
  }
}
