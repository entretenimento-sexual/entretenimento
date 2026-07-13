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
  AdminVideoModerationDecision,
  AdminVideoModerationService,
  AdminVideoProcessingJobState,
  IAdminVideoModerationItem,
  IAdminVideoProcessingStatus,
} from 'src/app/core/services/moderation/admin-video-moderation.service';
import {
  AdminVideoProcessingRecoveryAction,
  AdminVideoProcessingRecoveryService,
  IAdminVideoProcessingRecoveryJob,
} from 'src/app/core/services/moderation/admin-video-processing-recovery.service';

type VideoModerationQueueStatus = 'loading' | 'ready' | 'empty' | 'error';

interface VideoModerationQueueState {
  status: VideoModerationQueueStatus;
  items: IAdminVideoModerationItem[];
  skippedItems: number;
}

type VideoProcessingPanelStatus = 'loading' | 'ready' | 'error';

interface VideoProcessingPanelState {
  status: VideoProcessingPanelStatus;
  data: IAdminVideoProcessingStatus | null;
}

interface VideoProcessingRecoveryPanelState {
  status: VideoModerationQueueStatus;
  items: IAdminVideoProcessingRecoveryJob[];
  skippedItems: number;
  checkedAt: number;
}

interface PendingRecoveryConfirmation {
  key: string;
  action: AdminVideoProcessingRecoveryAction;
}

type ReasonDrafts = Record<string, string>;

const ACCESS_REFRESH_INTERVAL_MS = 8 * 60 * 1000;
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
  private readonly notification = inject(ErrorNotificationService);

  private readonly refreshSubject = new BehaviorSubject<number>(0);
  readonly busyVideoKey = signal<string | null>(null);
  readonly busyRecoveryKey = signal<string | null>(null);
  readonly reasonDrafts = signal<ReasonDrafts>({});
  readonly recoveryReasonDrafts = signal<ReasonDrafts>({});
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

  readonly state$: Observable<VideoModerationQueueState> = merge(
    this.refreshSubject,
    timer(ACCESS_REFRESH_INTERVAL_MS, ACCESS_REFRESH_INTERVAL_MS)
  ).pipe(
    switchMap(() =>
      this.moderation.listPendingVideos$(60).pipe(
        map(({ items, skippedItems }) => ({
          status: items.length > 0 ? 'ready' : 'empty',
          items,
          skippedItems,
        } as VideoModerationQueueState)),
        startWith({
          status: 'loading',
          items: [],
          skippedItems: 0,
        } as VideoModerationQueueState),
        catchError(() => of({
          status: 'error',
          items: [],
          skippedItems: 0,
        } as VideoModerationQueueState))
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  processingStateLabel(status: IAdminVideoProcessingStatus): string {
    if (status.state === 'READY') {
      return 'Operacional';
    }

    if (status.state === 'EMULATOR') {
      return 'Emulator';
    }

    return 'Ação necessária';
  }

  processingStateDescription(status: IAdminVideoProcessingStatus): string {
    if (status.state === 'READY') {
      return 'A API respondeu com a identidade usada pelas Functions.';
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
      case 'CANCEL_ACTIVE':
        return 'Cancelar processamento';
    }
  }

  recoveryActionDescription(
    action: AdminVideoProcessingRecoveryAction
  ): string {
    switch (action) {
      case 'RETRY_FAILED':
        return 'Cria uma nova versão de processamento e preserva o original privado.';
      case 'RECHECK_STALE':
        return 'Libera o lease para que o reconciliador confirme o job sem duplicá-lo.';
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
                : 'Cancelamento solicitado. A limpeza continuará em segundo plano.'
        );
        this.retry();
      },
      error: () => {
        this.notification.showError(
          'Não foi possível concluir a recuperação deste processamento.'
        );
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

  setReason(item: IAdminVideoModerationItem, value: string): void {
    const key = this.itemKey(item);

    this.reasonDrafts.update((drafts) => ({
      ...drafts,
      [key]: String(value ?? '').slice(0, 900),
    }));
  }

  reason(item: IAdminVideoModerationItem): string {
    return this.reasonDrafts()[this.itemKey(item)] ?? '';
  }

  approve(item: IAdminVideoModerationItem): void {
    this.review(item, 'APPROVE', this.reason(item));
  }

  reject(item: IAdminVideoModerationItem): void {
    const reason = this.reason(item).trim();

    if (reason.length < 8) {
      this.notification.showWarning(
        'Informe um motivo objetivo, com pelo menos 8 caracteres.'
      );
      return;
    }

    this.review(item, 'REJECT', reason);
  }

  isBusy(item: IAdminVideoModerationItem): boolean {
    return this.busyVideoKey() === this.itemKey(item);
  }

  trackByVideo(_: number, item: IAdminVideoModerationItem): string {
    return this.itemKey(item);
  }

  formatDuration(durationMs: number | null): string {
    const totalSeconds = Math.max(0, Math.floor(Number(durationMs ?? 0) / 1000));

    if (!totalSeconds) {
      return 'Duração não informada';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [hours, minutes, seconds]
        .map((value, index) => index === 0
          ? String(value)
          : String(value).padStart(2, '0'))
        .join(':');
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  formatFileSize(sizeBytes: number): string {
    const size = Number(sizeBytes ?? 0);

    if (!Number.isFinite(size) || size <= 0) {
      return 'Tamanho não informado';
    }

    if (size < 1024 * 1024) {
      return `${Math.round(size / 1024)} KB`;
    }

    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  publishedDate(value: number): Date | null {
    return Number.isFinite(value) && value > 0 ? new Date(value) : null;
  }

  private review(
    item: IAdminVideoModerationItem,
    decision: AdminVideoModerationDecision,
    reason: string
  ): void {
    const key = this.itemKey(item);

    if (!key || this.busyVideoKey()) {
      return;
    }

    this.busyVideoKey.set(key);

    this.moderation.reviewVideo$({
      ownerUid: item.ownerUid,
      videoId: item.videoId,
      decision,
      reason: reason.trim() || null,
    }).pipe(
      finalize(() => this.busyVideoKey.set(null)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        this.clearReason(item);
        this.notification.showSuccess(
          result.moderationStatus === 'APPROVED'
            ? 'Vídeo aprovado e liberado no perfil.'
            : result.cleanupPending
              ? 'Vídeo rejeitado. A limpeza física continuará em segundo plano.'
              : 'Vídeo rejeitado e removido da área pública.'
        );
        this.retry();
      },
      error: () => {
        this.notification.showError(
          'Não foi possível concluir a revisão deste vídeo.'
        );
      },
    });
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

  private clearReason(item: IAdminVideoModerationItem): void {
    const key = this.itemKey(item);

    this.reasonDrafts.update((drafts) => {
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
    return `${item.ownerUid}:${item.videoId}`;
  }

  private itemKey(item: IAdminVideoModerationItem): string {
    return `${item.ownerUid}:${item.videoId}`;
  }
}
