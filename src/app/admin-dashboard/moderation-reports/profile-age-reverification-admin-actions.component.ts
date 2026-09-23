import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { AdminMaterialModule } from '../admin-material.module';
import {
  AdminModerationReportService,
  AdminModerationReportVm,
} from 'src/app/core/services/moderation/admin-moderation-report.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

type AgeEvidenceMethod =
  | 'MANUAL_DOCUMENT_REVIEW'
  | 'PROVIDER_ESCALATION'
  | 'PROFILE_KYC';

@Component({
  selector: 'app-profile-age-reverification-admin-actions',
  standalone: true,
  imports: [CommonModule, AdminMaterialModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="age-review-actions" aria-label="Ações de verificação de idade">
      @if (report.reason === 'age_verification_request') {
        @if (report.status === 'open' || report.status === 'reviewing') {
          <p>
            Solicitação inicial ou contestação de maioridade. A decisão final
            exige evidência confiável revisada fora da autodeclaração.
          </p>
          <ng-container *ngTemplateOutlet="evidenceForm"></ng-container>
          <div class="age-review-actions__buttons">
            <button
              mat-flat-button
              type="button"
              color="primary"
              (click)="reviewInitialVerification('VERIFY')"
              [disabled]="busy() || !hasEvidence()"
            >
              {{ busy() ? 'Atualizando...' : 'Confirmar maioridade' }}
            </button>
            <button
              mat-stroked-button
              type="button"
              color="warn"
              (click)="reviewInitialVerification('REJECT')"
              [disabled]="busy() || !hasEvidence()"
            >
              Confirmar menoridade
            </button>
          </div>
        } @else {
          <p role="status">
            Solicitação de verificação encerrada.
          </p>
        }
      } @else if (!report.ageReverificationStatus) {
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
      } @else if (report.ageReverificationStatus === 'REQUIRED') {
        <p role="status">
          A revalidação foi solicitada. A conta está limitada e aguarda o envio do usuário.
        </p>
      } @else if (
        report.ageReverificationStatus === 'SUBMITTED' ||
        report.ageReverificationStatus === 'UNDER_REVIEW'
      ) {
        <p role="status">
          A autodeclaração enviada pelo usuário é apenas um sinal para análise.
          Para decidir, registre uma referência de evidência confiável.
        </p>
        <ng-container *ngTemplateOutlet="evidenceForm" />
        <div class="age-review-actions__buttons">
          <button
            mat-flat-button
            type="button"
            color="primary"
            (click)="reviewReverification('VERIFY')"
            [disabled]="busy() || !hasEvidence()"
          >
            {{ busy() ? 'Atualizando...' : 'Confirmar maioridade' }}
          </button>
          <button
            mat-stroked-button
            type="button"
            color="warn"
            (click)="reviewReverification('REJECT')"
            [disabled]="busy() || !hasEvidence()"
          >
            Confirmar menoridade
          </button>
        </div>
      } @else {
        <p role="status">
          Revalidação encerrada: <strong>{{ statusLabel }}</strong>.
        </p>
      }

      <ng-template #evidenceForm>
        <div class="age-review-actions__evidence">
          <label>
            Método da evidência
            <select
              [value]="evidenceMethod()"
              (change)="setEvidenceMethod($event)"
              [disabled]="busy()"
            >
              <option value="MANUAL_DOCUMENT_REVIEW">Revisão documental</option>
              <option value="PROVIDER_ESCALATION">Escalonamento do provedor</option>
              <option value="PROFILE_KYC">KYC de perfil</option>
            </select>
          </label>

          <label>
            Referência da evidência
            <input
              type="text"
              maxlength="300"
              autocomplete="off"
              [value]="evidenceReference()"
              (input)="setEvidenceReference($event)"
              [disabled]="busy()"
              placeholder="ID opaco do caso/provedor"
            />
          </label>

          <small>
            Não informe CPF, nome civil, data de nascimento ou número de
            documento. O backend persiste apenas o hash desta referência.
          </small>
        </div>
      </ng-template>
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
    .age-review-actions__evidence {
      display: grid;
      gap: .7rem;
    }
    .age-review-actions__evidence label {
      display: grid;
      gap: .35rem;
      font-weight: 600;
    }
    .age-review-actions__evidence input,
    .age-review-actions__evidence select {
      width: 100%;
      box-sizing: border-box;
      padding: .65rem .75rem;
      border-radius: .55rem;
      border: 1px solid rgba(127, 127, 127, .45);
      background: inherit;
      color: inherit;
    }
    .age-review-actions__evidence small {
      line-height: 1.4;
      opacity: .8;
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
  readonly evidenceMethod = signal<AgeEvidenceMethod>('MANUAL_DOCUMENT_REVIEW');
  readonly evidenceReference = signal('');

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

  hasEvidence(): boolean {
    return this.evidenceReference().trim().length >= 8;
  }

  setEvidenceReference(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.evidenceReference.set(
      String(input?.value ?? '').trimStart().slice(0, 300)
    );
  }

  setEvidenceMethod(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    const value = String(select?.value ?? '').trim() as AgeEvidenceMethod;

    if (
      value === 'MANUAL_DOCUMENT_REVIEW' ||
      value === 'PROVIDER_ESCALATION' ||
      value === 'PROFILE_KYC'
    ) {
      this.evidenceMethod.set(value);
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

  reviewInitialVerification(decision: 'VERIFY' | 'REJECT'): void {
    const fallback = decision === 'VERIFY'
      ? 'Maioridade confirmada após revisão de evidência confiável.'
      : 'Menoridade confirmada após revisão de evidência confiável.';

    this.execute(
      this.reportsService.reviewInitialAgeVerification$(
        this.report.id,
        decision,
        this.resolvedNote(fallback),
        this.evidenceMethod(),
        this.evidenceReference()
      ),
      decision === 'VERIFY'
        ? 'Maioridade confirmada. A conta pode seguir para o consentimento adulto.'
        : 'Menoridade confirmada. O acesso adulto permanece bloqueado.'
    );
  }

  reviewReverification(decision: 'VERIFY' | 'REJECT'): void {
    const fallback = decision === 'VERIFY'
      ? 'Maioridade confirmada após revisão de evidência confiável.'
      : 'Menoridade confirmada após revisão de evidência confiável.';
    const resolution = this.resolvedNote(fallback);

    this.execute(
      this.reportsService.reviewProfileAgeReverification$(
        this.report.id,
        decision,
        resolution,
        this.evidenceMethod(),
        this.evidenceReference()
      ),
      decision === 'VERIFY'
        ? 'Maioridade confirmada e restrição de idade encerrada.'
        : 'Menoridade confirmada e conta suspensa pela moderação.'
    );
  }

  private execute(
    operation$: Observable<void>,
    successMessage: string
  ): void {
    if (this.busy() || !this.report?.id) {
      return;
    }

    this.busy.set(true);

    operation$
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.evidenceReference.set('');
          this.notification.showSuccess(successMessage);
        },
        error: () => this.notification.showError(
          'Não foi possível concluir a ação de verificação de idade.'
        ),
      });
  }

  private resolvedNote(fallback: string): string {
    return String(this.resolution ?? '').trim().slice(0, 900) || fallback;
  }
}
