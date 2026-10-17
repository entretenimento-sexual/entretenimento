import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  merge,
  of,
  timer,
} from 'rxjs';
import {
  catchError,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  AdminVideoModerationService,
  AdminVideoProcessingJobState,
  IAdminVideoProcessingStatus,
} from 'src/app/core/services/moderation/admin-video-moderation.service';
import {
  AdminVideoTerminalTemporaryCleanupService,
  IAdminVideoTerminalCleanupReview,
  IAdminVideoTerminalCleanupReviews,
} from 'src/app/core/services/moderation/admin-video-terminal-temporary-cleanup.service';
import {
  AdminVideoProcessingRecoveryAction,
  AdminVideoProcessingRecoveryService,
  IAdminVideoProcessingRecoveryJob,
} from 'src/app/core/services/moderation/admin-video-processing-recovery.service';

type VideoProcessingPanelStatus = 'loading' | 'ready' | 'error';
type VideoRecoveryPanelStatus = 'loading' | 'ready' | 'empty' | 'error';
type RecoveryReasonDrafts = Record<string, string>;

interface VideoProcessingPanelState {
  status: VideoProcessingPanelStatus;
  data: IAdminVideoProcessingStatus | null;
}

interface VideoProcessingRecoveryPanelState {
  status: VideoRecoveryPanelStatus;
  items: IAdminVideoProcessingRecoveryJob[];
  skippedItems: number;
  checkedAt: number;
}

interface PendingRecoveryConfirmation {
  key: string;
  action: AdminVideoProcessingRecoveryAction;
}

const PROCESSING_STATUS_REFRESH_INTERVAL_MS = 60 * 1000;

@Component({
  selector: 'app-video-moderation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './video-moderation.component.html',
  styleUrls: [
    './video-moderation.component.css',
    './video-moderation-recovery.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoModerationComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly moderation = inject(AdminVideoModerationService);
  private readonly recovery = inject(AdminVideoProcessingRecoveryService);
  private readonly terminalCleanup = inject(AdminVideoTerminalTemporaryCleanupService);
  private readonly notification = inject(ErrorNotificationService);

  private readonly refreshSubject = new BehaviorSubject<number>(0);
  readonly busyRecoveryKey = signal<string | null>(null);
  readonly recoveryReasonDrafts = signal<RecoveryReasonDrafts>({});
  readonly terminalCleanupReasonDrafts = signal<Record<string, string>>({});
  readonly pendingTerminalCleanupConfirmation = signal<string | null>(null);
  readonly busyTerminalCleanupQueue = signal<string | null>(null);
  readonly pendingRecoveryConfirmation =
    signal<PendingRecoveryConfirmation | null>(null);

  readonly processingState$: Observable<VideoProcessingPanelState> = merge(
    this.refreshSubject,
    timer(
      PROCESSING_STATUS_REFRESH_INTERVAL_MS,
      PROCESSING_STATUS_REFRESH_INTERVAL_MS
    )
  ).pipe(
    switchMap(() =>
      this.moderation.getProcessingStatus$().pipe(
        map((data) => ({
          status: 'ready',
          data,
        } as VideoProcessingPanelState)),
        startWith({
          status: 'loading',
          data: null,
        } as VideoProcessingPanelState),
        catchError(() => of({
          status: 'error',
          data: null,
        } as VideoProcessingPanelState))
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly recoveryState$: Observable<VideoProcessingRecoveryPanelState> = merge(
    this.refreshSubject,
    timer(
      PROCESSING_STATUS_REFRESH_INTERVAL_MS,
      PROCESSING_STATUS_REFRESH_INTERVAL_MS
    )
  ).pipe(
    switchMap(() =>
      this.recovery.listRecoveryJobs$(30).pipe(
        map(({ items, skippedItems, checkedAt }) => ({
          status: items.length > 0 ? 'ready' : 'empty',
          items,
          skippedItems,
          checkedAt,
        } as VideoProcessingRecoveryPanelState)),
        startWith({
          status: 'loading',
          items: [],
          skippedItems: 0,
          checkedAt: 0,
        } as VideoProcessingRecoveryPanelState),
        catchError(() => of({
          status: 'error',
          items: [],
          skippedItems: 0,
          checkedAt: 0,
        } as VideoProcessingRecoveryPanelState))
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );


  readonly terminalCleanupState$: Observable<{
    status: VideoRecoveryPanelStatus;
    data: IAdminVideoTerminalCleanupReviews | null;
  }> = merge(
    this.refreshSubject,
    timer(PROCESSING_STATUS_REFRESH_INTERVAL_MS, PROCESSING_STATUS_REFRESH_INTERVAL_MS)
  ).pipe(
    switchMap(() => this.terminalCleanup.listReviews$(30).pipe(
      map(data => ({
        status: data.totalReview > 0 ? 'ready' : 'empty',
        data,
      } as const)),
      startWith({ status: 'loading', data: null } as const),
      catchError(() => of({ status: 'error', data: null } as const))
    )),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  terminalCleanupReason(review: IAdminVideoTerminalCleanupReview): string {
    return this.terminalCleanupReasonDrafts()[review.queueId] ?? '';
  }

  setTerminalCleanupReason(review: IAdminVideoTerminalCleanupReview, value: string): void {
    this.terminalCleanupReasonDrafts.update(drafts => ({
      ...drafts, [review.queueId]: String(value ?? '').slice(0, 900),
    }));
  }

  beginTerminalCleanupRecheck(review: IAdminVideoTerminalCleanupReview): void {
    if (this.busyTerminalCleanupQueue() || !review.recheckable) return;
    this.pendingTerminalCleanupConfirmation.set(review.queueId);
  }

  cancelTerminalCleanupRecheck(): void {
    this.pendingTerminalCleanupConfirmation.set(null);
  }

  confirmTerminalCleanupRecheck(review: IAdminVideoTerminalCleanupReview): void {
    if (!review.recheckable || this.busyTerminalCleanupQueue() ||
        this.pendingTerminalCleanupConfirmation() !== review.queueId) return;
    const reason = this.terminalCleanupReason(review).trim();
    if (reason.length < 8) {
      this.notification.showWarning('Informe uma justificativa com pelo menos 8 caracteres.');
      return;
    }
    this.busyTerminalCleanupQueue.set(review.queueId);
    this.terminalCleanup.recheckReview$({
      queueId: review.queueId,
      processingVersion: review.processingVersion,
      expectedUpdatedAt: review.updatedAt,
      operationId: this.createOperationId(),
      reason,
    }).pipe(
      finalize(() => this.busyTerminalCleanupQueue.set(null)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: result => {
        this.pendingTerminalCleanupConfirmation.set(null);
        this.terminalCleanupReasonDrafts.update(drafts => {
          const next = { ...drafts };
          delete next[review.queueId];
          return next;
        });
        this.notification.showSuccess(result.alreadyApplied
          ? 'A reconferência já havia sido agendada.'
          : 'Reconferência agendada. Nenhuma exclusão foi autorizada diretamente.');
        this.retry();
      },
      error: () => {
        // Erros reportados pelo MediaApplicationErrorService, sem toast duplicado.
      },
    });
  }

  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  processingStateLabel(status: IAdminVideoProcessingStatus): string {
    if (status.state === 'READY') {
      return 'Transcoder acessível';
    }

    if (status.state === 'EMULATOR') {
      return 'Emulator';
    }

    return 'Ação necessária';
  }

  processingStateDescription(status: IAdminVideoProcessingStatus): string {
    if (status.state === 'READY') {
      return 'A API do Transcoder respondeu com a identidade usada pelas Functions.';
    }

    if (status.state === 'EMULATOR') {
      return 'A consulta externa foi bloqueada no ambiente local por segurança.';
    }

    return status.provider.errorMessage ||
      'A API, a região ou as permissões do Transcoder precisam ser revisadas.';
  }

  processingJobStateLabel(state: AdminVideoProcessingJobState): string {
    switch (state) {
      case 'QUEUED':
        return 'Na fila';
      case 'SUBMITTING':
        return 'Confirmando envio';
      case 'PROCESSING':
        return 'Processando';
      case 'SUCCEEDED':
        return 'Concluído';
      case 'FAILED':
        return 'Falhou';
      case 'CANCEL_REQUESTED':
        return 'Cancelamento pendente';
      case 'CANCELLED':
        return 'Cancelado';
    }
  }

  recoveryActionLabel(action: AdminVideoProcessingRecoveryAction): string {
    switch (action) {
      case 'RETRY_FAILED':
        return 'Reprocessar vídeo';
      case 'RECHECK_STALE':
        return 'Revalidar job atrasado';
      case 'RECHECK_UNCONFIRMED':
        return 'Conferir submissão externa';
      case 'RECHECK_PROVIDER':
        return 'Reconferir estado no Transcoder';
      case 'CANCEL_ACTIVE':
        return 'Cancelar processamento';
    }
  }

  recoveryActionDescription(
    action: AdminVideoProcessingRecoveryAction
  ): string {
    switch (action) {
      case 'RETRY_FAILED':
        return 'Cria uma nova versão de processamento e preserva a fonte protegida.';
      case 'RECHECK_STALE':
        return 'Libera o lease para que o reconciliador confirme o job sem duplicá-lo.';
      case 'RECHECK_UNCONFIRMED':
        return 'Solicita nova consulta ao Transcoder. Não reenvia o vídeo e não libera novo processamento.';
      case 'RECHECK_PROVIDER':
        return 'Consulta o job externo existente sem criar outro job ou autorizar exclusões.';
      case 'CANCEL_ACTIVE':
        return 'Solicita cancelamento e limpeza técnica em segundo plano.';
    }
  }

  formatAge(ageMs: number | null): string {
    if (!ageMs || ageMs <= 0) {
      return 'Agora';
    }

    const totalMinutes = Math.max(1, Math.floor(ageMs / 60_000));

    if (totalMinutes < 60) {
      return `${totalMinutes} min`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours < 24) {
      return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0
      ? `${days} d ${remainingHours} h`
      : `${days} d`;
  }

  setRecoveryReason(
    item: IAdminVideoProcessingRecoveryJob,
    value: string
  ): void {
    const key = this.recoveryItemKey(item);

    this.recoveryReasonDrafts.update((drafts) => ({
      ...drafts,
      [key]: String(value ?? '').slice(0, 900),
    }));
  }

  recoveryReason(item: IAdminVideoProcessingRecoveryJob): string {
    return this.recoveryReasonDrafts()[this.recoveryItemKey(item)] ?? '';
  }

  beginRecovery(
    item: IAdminVideoProcessingRecoveryJob,
    action: AdminVideoProcessingRecoveryAction
  ): void {
    if (
      this.busyRecoveryKey() ||
      !item.availableActions.includes(action)
    ) {
      return;
    }

    this.pendingRecoveryConfirmation.set({
      key: this.recoveryItemKey(item),
      action,
    });
  }

  cancelRecoveryConfirmation(): void {
    this.pendingRecoveryConfirmation.set(null);
  }

  isRecoveryConfirmation(
    item: IAdminVideoProcessingRecoveryJob,
    action: AdminVideoProcessingRecoveryAction
  ): boolean {
    const pending = this.pendingRecoveryConfirmation();
    return pending?.key === this.recoveryItemKey(item) &&
      pending.action === action;
  }

  confirmRecovery(
    item: IAdminVideoProcessingRecoveryJob,
    action: AdminVideoProcessingRecoveryAction
  ): void {
    const key = this.recoveryItemKey(item);
    const reason = this.recoveryReason(item).trim();

    if (!this.isRecoveryConfirmation(item, action) || this.busyRecoveryKey()) {
      return;
    }

    if (reason.length < 8) {
      this.notification.showWarning(
        'Informe uma justificativa objetiva, com pelo menos 8 caracteres.'
      );
      return;
    }

    this.busyRecoveryKey.set(key);

    this.recovery.recoverJob$({
      ownerUid: item.ownerUid,
      videoId: item.videoId,
      action,
      expectedProcessingVersion: item.processingVersion,
      reason,
      operationId: this.createOperationId(),
    }).pipe(
      finalize(() => this.busyRecoveryKey.set(null)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        this.pendingRecoveryConfirmation.set(null);
        this.clearRecoveryReason(item);
        this.notification.showSuccess(
          result.alreadyApplied
            ? 'A ação já havia sido confirmada anteriormente.'
            : action === 'RETRY_FAILED'
              ? result.cleanupPending
                ? 'Novo processamento agendado. A versão anterior será limpa em segundo plano.'
                : 'Novo processamento agendado.'
              : action === 'RECHECK_STALE'
                ? 'Job liberado para nova reconciliação segura.'
                : action === 'RECHECK_UNCONFIRMED'
                  ? 'Consulta externa solicitada. Nenhum novo envio foi autorizado.'
                  : action === 'RECHECK_PROVIDER'
                    ? 'Reconferência agendada. Nenhum novo envio ou descarte foi autorizado.'
                    : 'Cancelamento solicitado. A limpeza continuará em segundo plano.'
        );
        this.retry();
      },
      error: () => {
        // A apresentação técnica é centralizada no MediaApplicationErrorService
        // pelo serviço de recovery. Evita mensagem manual e toast duplicado.
      },
    });
  }

  isRecoveryBusy(item: IAdminVideoProcessingRecoveryJob): boolean {
    return this.busyRecoveryKey() === this.recoveryItemKey(item);
  }

  trackByRecoveryJob(
    _: number,
    item: IAdminVideoProcessingRecoveryJob
  ): string {
    return item.jobId || this.recoveryItemKey(item);
  }

  private clearRecoveryReason(
    item: IAdminVideoProcessingRecoveryJob
  ): void {
    const key = this.recoveryItemKey(item);

    this.recoveryReasonDrafts.update((drafts) => {
      const next = { ...drafts };
      delete next[key];
      return next;
    });
  }

  private createOperationId(): string {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  }

  private recoveryItemKey(item: IAdminVideoProcessingRecoveryJob): string {
    return JSON.stringify([item.ownerUid, item.videoId]);
  }
}