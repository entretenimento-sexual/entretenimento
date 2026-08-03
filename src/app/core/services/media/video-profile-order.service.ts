import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export interface IOrderableProfileVideo {
  videoId: string;
  title: string;
  orderIndex: number;
  publishedAt: number;
}

interface VideoPublicationOrderDoc {
  id?: string;
  videoId?: string;
  title?: string | null;
  isPublished?: boolean;
  moderationStatus?: string;
  orderIndex?: number;
  publishedAt?: unknown;
}

interface ReorderProfileVideosRequest {
  ownerUid: string;
  orderedVideoIds: string[];
}

interface ReorderProfileVideosResponse {
  updatedCount: number;
  unchanged: boolean;
}

@Injectable({ providedIn: 'root' })
export class VideoProfileOrderService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);

  private readonly reorderCallable = httpsCallable<
    ReorderProfileVideosRequest,
    ReorderProfileVideosResponse
  >(this.functions, 'reorderProfileVideos');

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  watchOrderableVideos$(ownerUid: string): Observable<IOrderableProfileVideo[]> {
    const safeOwnerUid = this.normalizeId(ownerUid);

    if (!safeOwnerUid) {
      return throwError(() => new Error('Perfil inválido para ordenação.'));
    }

    return this.firestoreCtx.deferObservable$(() => {
      const publicationCollection = collection(
        this.firestore,
        `users/${safeOwnerUid}/video_publications`
      );

      return collectionData(publicationCollection, { idField: 'id' }).pipe(
        map((documents) =>
          (documents as VideoPublicationOrderDoc[])
            .filter((document) =>
              document.isPublished === true &&
              String(document.moderationStatus ?? '')
                .trim()
                .toUpperCase() === 'APPROVED'
            )
            .map((document) => {
              const videoId = this.normalizeId(
                document.videoId ?? document.id
              );

              return {
                videoId,
                title: this.normalizeTitle(document.title),
                orderIndex: this.normalizeOrderIndex(document.orderIndex),
                publishedAt: this.toMillis(document.publishedAt),
              };
            })
            .filter((item) => !!item.videoId)
            .sort((left, right) =>
              left.orderIndex - right.orderIndex ||
              right.publishedAt - left.publishedAt ||
              left.videoId.localeCompare(right.videoId)
            )
        )
      );
    }).pipe(
      catchError((error: unknown) => {
        this.reportError(error, 'watchOrderableVideos$');
        return throwError(() => error);
      })
    );
  }

  reorder$(
    ownerUid: string,
    orderedVideoIds: readonly string[]
  ): Observable<ReorderProfileVideosResponse> {
    const payload: ReorderProfileVideosRequest = {
      ownerUid: this.normalizeId(ownerUid),
      orderedVideoIds: orderedVideoIds.map((videoId) =>
        this.normalizeId(videoId)
      ),
    };

    if (
      !payload.ownerUid ||
      payload.orderedVideoIds.some((videoId) => !videoId) ||
      new Set(payload.orderedVideoIds).size !== payload.orderedVideoIds.length
    ) {
      return throwError(() => new Error('Ordem de vídeos inválida.'));
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const response = await this.reorderCallable(payload);
      return response.data;
    }).pipe(
      catchError((error: unknown) => {
        this.reportError(error, 'reorder$');
        return throwError(() => error);
      })
    );
  }

  private normalizeId(value: unknown): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private normalizeTitle(value: unknown): string {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Vídeo do perfil';
  }

  private normalizeOrderIndex(value: unknown): number {
    const numberValue = Number(value ?? 0);
    return Number.isFinite(numberValue)
      ? Math.max(0, Math.min(10_000, Math.trunc(numberValue)))
      : 0;
  }

  private toMillis(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    const timestamp = value as { toMillis?: () => number } | null | undefined;
    return typeof timestamp?.toMillis === 'function'
      ? timestamp.toMillis()
      : 0;
  }

  private reportError(error: unknown, op: string): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Falha na ordenação dos vídeos do perfil.');
      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'VideoProfileOrderService',
        op,
      };
      (normalizedError as any).skipUserNotification = true;
      this.globalErrorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
