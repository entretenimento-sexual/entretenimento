import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export interface IAdminVideoModerationItem {
  ownerUid: string;
  videoId: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  publishedAt: number;
  moderationStatus: 'PENDING_REVIEW';
  url: string;
  posterUrl: string | null;
  accessExpiresAt: number;
}

interface ListVideoModerationQueueRequest {
  limit: number;
}

interface ListVideoModerationQueueResponse {
  items: IAdminVideoModerationItem[];
  skippedItems: number;
}

export type AdminVideoModerationDecision = 'APPROVE' | 'REJECT';

interface ReviewVideoModerationRequest {
  ownerUid: string;
  videoId: string;
  decision: AdminVideoModerationDecision;
  reason: string | null;
}

export interface IAdminVideoModerationResult {
  ownerUid: string;
  videoId: string;
  moderationStatus: 'APPROVED' | 'REJECTED';
  cleanupPending: boolean;
}

@Injectable({ providedIn: 'root' })
export class AdminVideoModerationService {
  private readonly functions = inject(Functions);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  listPendingVideos$(limit = 40): Observable<{
    items: IAdminVideoModerationItem[];
    skippedItems: number;
  }> {
    const safeLimit = Math.max(1, Math.min(80, Math.trunc(limit)));

    return defer(() => {
      const callable = httpsCallable<
        ListVideoModerationQueueRequest,
        ListVideoModerationQueueResponse
      >(this.functions, 'listVideoModerationQueue');

      return from(callable({ limit: safeLimit }));
    }).pipe(
      map((response) => ({
        items: Array.isArray(response.data?.items)
          ? response.data.items.map((item) => this.normalizeItem(item))
          : [],
        skippedItems: this.normalizeNonNegativeInteger(
          response.data?.skippedItems
        ),
      })),
      catchError((error) => {
        this.reportError(error, 'listPendingVideos$', {});
        return throwError(() => error);
      })
    );
  }

  reviewVideo$(command: {
    ownerUid: string;
    videoId: string;
    decision: AdminVideoModerationDecision;
    reason?: string | null;
  }): Observable<IAdminVideoModerationResult> {
    const payload: ReviewVideoModerationRequest = {
      ownerUid: this.normalizeId(command.ownerUid),
      videoId: this.normalizeId(command.videoId),
      decision: command.decision,
      reason: this.normalizeOptionalText(command.reason, 900),
    };

    if (!payload.ownerUid || !payload.videoId) {
      return throwError(
        () => new Error('Vídeo inválido para revisão administrativa.')
      );
    }

    if (
      payload.decision === 'REJECT' &&
      String(payload.reason ?? '').length < 8
    ) {
      return throwError(
        () => new Error('Informe um motivo objetivo para rejeitar o vídeo.')
      );
    }

    return defer(() => {
      const callable = httpsCallable<
        ReviewVideoModerationRequest,
        IAdminVideoModerationResult
      >(this.functions, 'reviewVideoModeration');

      return from(callable(payload));
    }).pipe(
      map((response) => response.data),
      catchError((error) => {
        this.reportError(error, 'reviewVideo$', {
          decision: payload.decision,
          hasOwnerUid: true,
          hasVideoId: true,
        });
        return throwError(() => error);
      })
    );
  }

  private normalizeItem(
    item: IAdminVideoModerationItem
  ): IAdminVideoModerationItem {
    return {
      ownerUid: this.normalizeId(item.ownerUid),
      videoId: this.normalizeId(item.videoId),
      title: this.normalizeOptionalText(item.title, 160) || 'Vídeo do perfil',
      mimeType: this.normalizeOptionalText(item.mimeType, 80) || 'video/mp4',
      sizeBytes: this.normalizeNonNegativeInteger(item.sizeBytes),
      durationMs: this.normalizeOptionalPositiveInteger(item.durationMs),
      publishedAt: this.normalizeNonNegativeInteger(item.publishedAt),
      moderationStatus: 'PENDING_REVIEW',
      url: String(item.url ?? '').trim(),
      posterUrl: this.normalizeOptionalText(item.posterUrl, 4096),
      accessExpiresAt: this.normalizeNonNegativeInteger(item.accessExpiresAt),
    };
  }

  private normalizeId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private normalizeOptionalText(
    value: unknown,
    maxLength: number
  ): string | null {
    const normalized = String(value ?? '').trim().slice(0, maxLength);
    return normalized || null;
  }

  private normalizeNonNegativeInteger(value: unknown): number {
    const numberValue = Number(value ?? 0);

    return Number.isFinite(numberValue) && numberValue >= 0
      ? Math.trunc(numberValue)
      : 0;
  }

  private normalizeOptionalPositiveInteger(value: unknown): number | null {
    const numberValue = Number(value ?? 0);

    return Number.isFinite(numberValue) && numberValue > 0
      ? Math.trunc(numberValue)
      : null;
  }

  private reportError(
    error: unknown,
    operation: string,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha na moderação administrativa de vídeos.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'AdminVideoModerationService',
        operation,
        ...context,
      };
      (normalized as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
