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
  IAdminVideoModerationItem,
} from 'src/app/core/services/moderation/admin-video-moderation.service';

type VideoModerationQueueStatus = 'loading' | 'ready' | 'empty' | 'error';

interface VideoModerationQueueState {
  status: VideoModerationQueueStatus;
  items: IAdminVideoModerationItem[];
  skippedItems: number;
}

type ReasonDrafts = Record<string, string>;

const ACCESS_REFRESH_INTERVAL_MS = 8 * 60 * 1000;

@Component({
  selector: 'app-video-moderation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './video-moderation.component.html',
  styleUrls: ['./video-moderation.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoModerationComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly moderation = inject(AdminVideoModerationService);
  private readonly notification = inject(ErrorNotificationService);

  private readonly refreshSubject = new BehaviorSubject<number>(0);
  readonly busyVideoKey = signal<string | null>(null);
  readonly reasonDrafts = signal<ReasonDrafts>({});

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

  private clearReason(item: IAdminVideoModerationItem): void {
    const key = this.itemKey(item);

    this.reasonDrafts.update((drafts) => {
      const next = { ...drafts };
      delete next[key];
      return next;
    });
  }

  private itemKey(item: IAdminVideoModerationItem): string {
    return `${item.ownerUid}:${item.videoId}`;
  }
}
