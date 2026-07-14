import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  orderBy,
  query,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import {
  IVideoPublicationConfig,
  IVideoPublicationSettingsInput,
  TVideoPublicationModerationStatus,
  TVideoPublicationVisibility,
} from 'src/app/core/interfaces/media/i-video-publication-config';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

interface PublishVideoRequest {
  ownerUid: string;
  videoId: string;
  visibility: Exclude<TVideoPublicationVisibility, 'PRIVATE'>;
  orderIndex: number;
}

interface PublishVideoResponse {
  videoId: string;
  moderationStatus: 'PENDING_REVIEW' | 'APPROVED';
}

interface VideoIdentityRequest {
  ownerUid: string;
  videoId: string;
}

interface UpdateVideoPublicationSettingsRequest
  extends IVideoPublicationSettingsInput {
  ownerUid: string;
  videoId: string;
}

export interface UpdateVideoPublicationSettingsResponse {
  videoId: string;
  moderationStatus: TVideoPublicationModerationStatus;
  isPublished: boolean;
}

interface UnpublishVideoResponse {
  videoId: string;
}

export interface DeleteProfileVideoResponse {
  videoId: string;
  cleanupPending: boolean;
}

interface VideoPublicationDoc {
  id?: string;
  videoId?: string;
  ownerUid?: string;
  isPublished?: boolean;
  visibility?: TVideoPublicationVisibility;
  orderIndex?: number;
  moderationStatus?: TVideoPublicationModerationStatus;
  moderationReason?: string | null;
  title?: string | null;
  description?: string | null;
  reactionsEnabled?: boolean;
  commentsEnabled?: boolean;
  ratingsEnabled?: boolean;
  publishedAt?: unknown;
  updatedAt?: unknown;
}

@Injectable({ providedIn: 'root' })
export class VideoPublicationService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);

  private readonly publishVideoCallable = httpsCallable<
    PublishVideoRequest,
    PublishVideoResponse
  >(this.functions, 'publishVideo');

  private readonly unpublishVideoCallable = httpsCallable<
    VideoIdentityRequest,
    UnpublishVideoResponse
  >(this.functions, 'unpublishVideo');

  private readonly deleteProfileVideoCallable = httpsCallable<
    VideoIdentityRequest,
    DeleteProfileVideoResponse
  >(this.functions, 'deleteProfileVideo');

  private readonly updateVideoPublicationSettingsCallable = httpsCallable<
    UpdateVideoPublicationSettingsRequest,
    UpdateVideoPublicationSettingsResponse
  >(this.functions, 'updateVideoPublicationSettings');

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  watchOwnVideoPublications$(
    ownerUid: string
  ): Observable<IVideoPublicationConfig[]> {
    const safeOwnerUid = this.normalizeId(ownerUid);

    if (!safeOwnerUid) {
      return of([]);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const publicationCollection = collection(
        this.firestore,
        `users/${safeOwnerUid}/video_publications`
      );
      const publicationQuery = query(
        publicationCollection,
        orderBy('updatedAt', 'desc')
      );

      return collectionData(publicationQuery, { idField: 'id' }).pipe(
        map((items) =>
          (items as VideoPublicationDoc[])
            .map((item) => this.mapPublication(safeOwnerUid, item))
            .filter((item) => !!item.videoId)
        )
      );
    }).pipe(
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'watchOwnVideoPublications$',
          hasOwnerUid: true,
        });
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  publishVideo$(
    ownerUid: string,
    videoId: string,
    orderIndex = 0
  ): Observable<PublishVideoResponse> {
    const payload: PublishVideoRequest = {
      ownerUid: this.normalizeId(ownerUid),
      videoId: this.normalizeId(videoId),
      visibility: 'PUBLIC',
      orderIndex: this.normalizeOrderIndex(orderIndex),
    };

    if (!payload.ownerUid || !payload.videoId) {
      return throwError(
        () => new Error('Vídeo inválido para publicação.')
      );
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.publishVideoCallable(payload);
      return response.data;
    }).pipe(
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'publishVideo$',
          hasOwnerUid: true,
          hasVideoId: true,
        });
        return throwError(() => error);
      })
    );
  }

  updateVideoPublicationSettings$(
    ownerUid: string,
    videoId: string,
    settings: IVideoPublicationSettingsInput
  ): Observable<UpdateVideoPublicationSettingsResponse> {
    const payload: UpdateVideoPublicationSettingsRequest = {
      ownerUid: this.normalizeId(ownerUid),
      videoId: this.normalizeId(videoId),
      title: this.normalizeOptionalText(settings.title, 120),
      description: this.normalizeOptionalText(settings.description, 1000),
      reactionsEnabled: settings.reactionsEnabled === true,
      commentsEnabled: settings.commentsEnabled === true,
      ratingsEnabled: settings.ratingsEnabled === true,
    };

    if (!payload.ownerUid || !payload.videoId) {
      return throwError(
        () => new Error('Vídeo inválido para edição.')
      );
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.updateVideoPublicationSettingsCallable(
        payload
      );
      return response.data;
    }).pipe(
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'updateVideoPublicationSettings$',
          hasOwnerUid: true,
          hasVideoId: true,
        });
        return throwError(() => error);
      })
    );
  }

  unpublishVideo$(
    ownerUid: string,
    videoId: string
  ): Observable<UnpublishVideoResponse> {
    const payload = this.buildIdentityPayload(ownerUid, videoId);

    if (!payload) {
      return throwError(
        () => new Error('Vídeo inválido para despublicação.')
      );
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.unpublishVideoCallable(payload);
      return response.data;
    }).pipe(
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'unpublishVideo$',
          hasOwnerUid: true,
          hasVideoId: true,
        });
        return throwError(() => error);
      })
    );
  }

  deleteProfileVideo$(
    ownerUid: string,
    videoId: string
  ): Observable<DeleteProfileVideoResponse> {
    const payload = this.buildIdentityPayload(ownerUid, videoId);

    if (!payload) {
      return throwError(
        () => new Error('Vídeo inválido para exclusão.')
      );
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.deleteProfileVideoCallable(payload);
      return response.data;
    }).pipe(
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'deleteProfileVideo$',
          hasOwnerUid: true,
          hasVideoId: true,
        });
        return throwError(() => error);
      })
    );
  }

  private buildIdentityPayload(
    ownerUid: string,
    videoId: string
  ): VideoIdentityRequest | null {
    const payload: VideoIdentityRequest = {
      ownerUid: this.normalizeId(ownerUid),
      videoId: this.normalizeId(videoId),
    };

    return payload.ownerUid && payload.videoId ? payload : null;
  }

  private mapPublication(
    ownerUid: string,
    item: VideoPublicationDoc
  ): IVideoPublicationConfig {
    const id = this.normalizeId(item.id ?? item.videoId);

    return {
      id,
      videoId: this.normalizeId(item.videoId ?? id),
      ownerUid: this.normalizeId(item.ownerUid ?? ownerUid),
      isPublished: item.isPublished === true,
      visibility: this.normalizeVisibility(item.visibility),
      orderIndex: this.normalizeOrderIndex(item.orderIndex),
      moderationStatus: this.normalizeModerationStatus(
        item.moderationStatus
      ),
      moderationReason: this.normalizeOptionalText(item.moderationReason),
      title: this.normalizeOptionalText(item.title, 120),
      description: this.normalizeOptionalText(item.description, 1000),
      reactionsEnabled: item.reactionsEnabled !== false,
      commentsEnabled: item.commentsEnabled !== false,
      ratingsEnabled: item.ratingsEnabled !== false,
      publishedAt: this.toMillis(item.publishedAt),
      updatedAt: this.toMillis(item.updatedAt),
    };
  }

  private normalizeId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private normalizeOrderIndex(value: unknown): number {
    const numberValue = Number(value ?? 0);

    if (!Number.isFinite(numberValue)) {
      return 0;
    }

    return Math.max(0, Math.min(10_000, Math.trunc(numberValue)));
  }

  private normalizeVisibility(
    value: unknown
  ): TVideoPublicationVisibility {
    const normalized = String(value ?? '').trim().toUpperCase();

    if (
      normalized === 'FRIENDS' ||
      normalized === 'SUBSCRIBERS' ||
      normalized === 'PREMIUM' ||
      normalized === 'PUBLIC'
    ) {
      return normalized;
    }

    return 'PRIVATE';
  }

  private normalizeModerationStatus(
    value: unknown
  ): TVideoPublicationModerationStatus {
    const normalized = String(value ?? '').trim().toUpperCase();

    if (
      normalized === 'PENDING_REVIEW' ||
      normalized === 'APPROVED' ||
      normalized === 'REJECTED' ||
      normalized === 'FLAGGED' ||
      normalized === 'HIDDEN'
    ) {
      return normalized;
    }

    return 'PRIVATE';
  }

  private normalizeOptionalText(
    value: unknown,
    maxLength = Number.MAX_SAFE_INTEGER
  ): string | null {
    const text = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
    return text || null;
  }

  private toMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    const timestamp = value as {
      toMillis?: () => number;
    } | null | undefined;

    return typeof timestamp?.toMillis === 'function'
      ? timestamp.toMillis()
      : null;
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Erro no fluxo de publicação do vídeo.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'VideoPublicationService',
        ...context,
      };
      (normalizedError as any).skipUserNotification = true;

      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
