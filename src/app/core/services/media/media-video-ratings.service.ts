import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

export interface VideoRatingSummary {
  ratingsCount: number;
  ratingAverage: number;
}

interface RateVideoRequest {
  ownerUid: string;
  videoId: string;
  rating: number;
}

interface RateVideoResponse extends VideoRatingSummary {
  rating: number;
  score: number;
}

interface PublicVideoRatingProjection {
  ratingsCount?: number;
  ratingAverage?: number;
}

interface ViewerVideoRatingProjection {
  rating?: number;
}

@Injectable({ providedIn: 'root' })
export class MediaVideoRatingsService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly rateVideoCallable = httpsCallable<
    RateVideoRequest,
    RateVideoResponse
  >(this.functions, 'rateVideo');

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  watchSummary$(
    ownerUid: string,
    videoId: string
  ): Observable<VideoRatingSummary> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safeVideoId = this.cleanId(videoId);

    if (!safeOwnerUid || !safeVideoId) {
      return of(this.emptySummary());
    }

    return this.firestoreCtx.deferObservable$(() => {
      const videoRef = doc(
        this.firestore,
        this.publicVideoPath(safeOwnerUid, safeVideoId)
      );

      return docData(videoRef).pipe(
        map((value) => {
          const video = value as PublicVideoRatingProjection | undefined;
          return {
            ratingsCount: this.normalizeCount(video?.ratingsCount),
            ratingAverage: this.normalizeAverage(video?.ratingAverage),
          };
        })
      );
    }).pipe(
      catchError((error) => {
        this.reportError(
          'Erro ao carregar avaliações do vídeo.',
          error,
          {
            op: 'watchSummary$',
            hasOwnerUid: !!safeOwnerUid,
            hasVideoId: !!safeVideoId,
          },
          true
        );
        return of(this.emptySummary());
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  watchViewerRating$(
    ownerUid: string,
    videoId: string,
    viewerUid: string | null
  ): Observable<number | null> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safeVideoId = this.cleanId(videoId);
    const safeViewerUid = this.cleanId(viewerUid);

    if (!safeOwnerUid || !safeVideoId || !safeViewerUid) {
      return of(null);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const ratingRef = doc(
        this.firestore,
        `${this.publicVideoPath(safeOwnerUid, safeVideoId)}/ratings/${safeViewerUid}`
      );

      return docData(ratingRef).pipe(
        map((value) => {
          const rating = value as ViewerVideoRatingProjection | undefined;
          return this.normalizeRating(rating?.rating);
        })
      );
    }).pipe(
      catchError((error) => {
        this.reportError(
          'Erro ao carregar sua avaliação.',
          error,
          {
            op: 'watchViewerRating$',
            hasOwnerUid: !!safeOwnerUid,
            hasVideoId: !!safeVideoId,
            hasViewerUid: !!safeViewerUid,
          },
          true
        );
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  rateVideo$(
    ownerUid: string,
    videoId: string,
    viewerUid: string | null,
    rating: number
  ): Observable<void> {
    const safeOwnerUid = this.cleanId(ownerUid);
    const safeVideoId = this.cleanId(videoId);
    const safeViewerUid = this.cleanId(viewerUid);
    const safeRating = this.normalizeRating(rating);

    if (
      !safeOwnerUid ||
      !safeVideoId ||
      !safeViewerUid ||
      safeRating === null
    ) {
      this.errorNotifier.showWarning('Avaliação inválida.');
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      await this.rateVideoCallable({
        ownerUid: safeOwnerUid,
        videoId: safeVideoId,
        rating: safeRating,
      });
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(
          'Erro ao avaliar o vídeo.',
          error,
          {
            op: 'rateVideo$',
            rating: safeRating,
            hasOwnerUid: !!safeOwnerUid,
            hasVideoId: !!safeVideoId,
            hasViewerUid: !!safeViewerUid,
          }
        );
        return of(void 0);
      })
    );
  }

  private publicVideoPath(ownerUid: string, videoId: string): string {
    return `public_profiles/${ownerUid}/public_videos/${videoId}`;
  }

  private cleanId(value: string | null | undefined): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private normalizeRating(value: unknown): number | null {
    const rating = Number(value);
    return Number.isInteger(rating) && rating >= 1 && rating <= 5
      ? rating
      : null;
  }

  private normalizeCount(value: unknown): number {
    const count = Number(value ?? 0);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  private normalizeAverage(value: unknown): number {
    const average = Number(value ?? 0);
    return Number.isFinite(average)
      ? Math.round(Math.max(0, Math.min(5, average)) * 100) / 100
      : 0;
  }

  private emptySummary(): VideoRatingSummary {
    return { ratingsCount: 0, ratingAverage: 0 };
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context: Record<string, unknown>,
    silent = false
  ): void {
    if (!silent) {
      this.errorNotifier.showError(userMessage);
    }

    try {
      const normalized = error instanceof Error
        ? error
        : new Error(userMessage);
      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'MediaVideoRatingsService',
        ...context,
      };
      (normalized as any).skipUserNotification = silent;
      this.errorHandler.handleError(normalized);
      this.privacyDebug.log('media', 'MediaVideoRatingsService: falha', context);
    } catch {
      // noop
    }
  }
}
