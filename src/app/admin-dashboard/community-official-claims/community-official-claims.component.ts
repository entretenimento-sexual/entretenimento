// src/app/admin-dashboard/community-official-claims/community-official-claims.component.ts

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  BehaviorSubject,
  Observable,
  catchError,
  finalize,
  of,
  shareReplay,
  switchMap,
} from 'rxjs';

import {
  CommunityOfficialClaimAdminDecision,
  CommunityOfficialClaimAdminItem,
  CommunityOfficialClaimReviewQueueResponse,
} from 'src/app/community/data-access/community-official-claim-admin.model';
import { CommunityOfficialClaimAdminRepository } from 'src/app/community/data-access/community-official-claim-admin.repository';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Component({
  selector: 'app-community-official-claims',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './community-official-claims.component.html',
  styleUrls: ['./community-official-claims.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityOfficialClaimsComponent {
  private readonly repository = inject(CommunityOfficialClaimAdminRepository);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly refreshSubject = new BehaviorSubject<void>(undefined);

  readonly busySubject = new BehaviorSubject<boolean>(false);
  readonly loadErrorSubject = new BehaviorSubject<string | null>(null);

  selectedItem: CommunityOfficialClaimAdminItem | null = null;
  selectedDecision: CommunityOfficialClaimAdminDecision | null = null;

  readonly reviewForm = this.formBuilder.group({
    resolution: ['', [Validators.required, Validators.minLength(8)]],
    verificationExpiresAt: [''],
    revalidationDueAt: [''],
  });

  readonly queue$: Observable<CommunityOfficialClaimReviewQueueResponse> =
    this.refreshSubject.pipe(
      switchMap(() => {
        this.loadErrorSubject.next(null);
        return this.repository.getReviewQueue$().pipe(
          catchError((error) => {
            const message = 'Não foi possível carregar a fila de Comunidades Oficiais.';
            this.loadErrorSubject.next(message);
            this.reportError(message, error, { op: 'loadReviewQueue' });
            return of({ items: [] });
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  refresh(): void {
    this.refreshSubject.next();
  }

  beginReview(
    item: CommunityOfficialClaimAdminItem,
    decision: CommunityOfficialClaimAdminDecision
  ): void {
    this.selectedItem = item;
    this.selectedDecision = decision;
    this.reviewForm.reset({
      resolution: '',
      verificationExpiresAt: '',
      revalidationDueAt: '',
    });
  }

  cancelReview(): void {
    this.selectedItem = null;
    this.selectedDecision = null;
    this.reviewForm.reset();
  }

  submitReview(): void {
    const item = this.selectedItem;
    const decision = this.selectedDecision;

    if (!item || !decision || this.busySubject.value) return;

    const resolution = String(this.reviewForm.controls.resolution.value ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    if (resolution.length < 8) {
      this.errorNotification.showWarning(
        'Informe uma justificativa objetiva com pelo menos 8 caracteres.'
      );
      return;
    }

    let verificationExpiresAt: number | null = null;
    let revalidationDueAt: number | null = null;

    if (decision === 'approve') {
      verificationExpiresAt = this.parseLocalDateTime(
        this.reviewForm.controls.verificationExpiresAt.value
      );
      revalidationDueAt = this.parseLocalDateTime(
        this.reviewForm.controls.revalidationDueAt.value
      );

      const now = Date.now();
      if (!verificationExpiresAt || verificationExpiresAt <= now) {
        this.errorNotification.showWarning(
          'Defina uma data futura para o vencimento da verificação.'
        );
        return;
      }

      if (
        revalidationDueAt !== null
        && (
          revalidationDueAt <= now
          || revalidationDueAt >= verificationExpiresAt
        )
      ) {
        this.errorNotification.showWarning(
          'A revalidação deve ocorrer no futuro e antes do vencimento.'
        );
        return;
      }
    }

    this.busySubject.next(true);

    this.repository
      .review$({
        associationKey: item.associationKey,
        decision,
        resolution,
        verificationExpiresAt,
        revalidationDueAt,
      })
      .pipe(
        finalize(() => this.busySubject.next(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.errorNotification.showSuccess('Revisão registrada.');
          this.cancelReview();
          this.refresh();
        },
        error: (error) => {
          this.reportError(
            'Não foi possível concluir a revisão da Comunidade Oficial.',
            error,
            {
              op: 'reviewOfficialClaim',
              associationKey: item.associationKey,
              decision,
            }
          );
        },
      });
  }

  canReject(item: CommunityOfficialClaimAdminItem): boolean {
    return item.status === 'pending'
      || item.status === 'under_review'
      || item.status === 'disputed';
  }

  canDispute(item: CommunityOfficialClaimAdminItem): boolean {
    return item.status === 'pending' || item.status === 'under_review';
  }

  canRevoke(item: CommunityOfficialClaimAdminItem): boolean {
    return item.status === 'under_review';
  }

  decisionLabel(decision: CommunityOfficialClaimAdminDecision | null): string {
    switch (decision) {
    case 'approve':
      return 'Aprovar vínculo oficial';
    case 'reject':
      return 'Rejeitar solicitação';
    case 'mark_disputed':
      return 'Marcar como contestada';
    case 'revoke':
      return 'Revogar vínculo';
    default:
      return 'Revisar solicitação';
    }
  }

  statusLabel(status: CommunityOfficialClaimAdminItem['status']): string {
    switch (status) {
    case 'pending':
      return 'Pendente';
    case 'under_review':
      return 'Em revisão';
    case 'disputed':
      return 'Contestada';
    }
  }

  targetLabel(type: CommunityOfficialClaimAdminItem['target']['type']): string {
    switch (type) {
    case 'profile':
      return 'Perfil';
    case 'organization':
      return 'Organização';
    case 'venue':
      return 'Local';
    case 'event':
      return 'Evento';
    }
  }

  private parseLocalDateTime(value: string | null | undefined): number | null {
    const normalized = String(value ?? '').trim();
    if (!normalized) return null;

    const epoch = new Date(normalized).getTime();
    return Number.isFinite(epoch) ? epoch : null;
  }

  private reportError(
    message: string,
    cause: unknown,
    context: Record<string, unknown>
  ): void {
    const error = new Error(message);
    (error as any).cause = cause;
    (error as any).original = cause;
    (error as any).context = {
      scope: 'CommunityOfficialClaimsComponent',
      ...context,
    };
    (error as any).skipUserNotification = true;

    try {
      this.globalErrorHandler.handleError(error);
    } catch {
      // noop
    }

    try {
      this.errorNotification.showError(message);
    } catch {
      // noop
    }
  }
}
