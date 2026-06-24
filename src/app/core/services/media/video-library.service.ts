// src/app/core/services/media/video-library.service.ts
// -----------------------------------------------------------------------------
// Leitura da biblioteca privada de vídeos.
//
// Nesta etapa não há publicação pública nem upload pela UI.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import { IVideoItem, VideoProcessingStatus } from 'src/app/core/interfaces/media/i-video-item';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

interface IVideoDoc {
  id?: string;
  url?: string;
  path?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  durationMs?: number | null;
  thumbnailUrl?: string | null;
  status?: VideoProcessingStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

@Injectable({ providedIn: 'root' })
export class VideoLibraryService {
  private readonly firestore = inject(Firestore);
  private readonly firestoreCtx = inject(FirestoreContextService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  watchPrivateVideos$(ownerUid: string): Observable<IVideoItem[]> {
    const safeOwnerUid = this.normalizeUid(ownerUid);

    if (!safeOwnerUid) {
      return of([]);
    }

    return this.firestoreCtx.deferObservable$(() => {
      const videosRef = collection(this.firestore, `users/${safeOwnerUid}/videos`);

      return collectionData(videosRef, { idField: 'id' }).pipe(
        map((items) =>
          (items as IVideoDoc[])
            .map((item) => this.mapVideoDoc(safeOwnerUid, item))
            .sort((a, b) => b.createdAt - a.createdAt)
        )
      );
    }).pipe(
      catchError((error) => {
        this.handleReadError(error, safeOwnerUid);
        return of([]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private mapVideoDoc(ownerUid: string, item: IVideoDoc): IVideoItem {
    return {
      id: String(item.id ?? '').trim(),
      ownerUid,
      url: String(item.url ?? '').trim(),
      path: this.normalizeOptionalText(item.path),
      fileName: this.normalizeOptionalText(item.fileName),
      mimeType: this.normalizeOptionalText(item.mimeType),
      sizeBytes: this.normalizeOptionalPositiveNumber(item.sizeBytes),
      durationMs: this.normalizeOptionalPositiveNumber(item.durationMs),
      thumbnailUrl: this.normalizeOptionalText(item.thumbnailUrl),
      status: this.normalizeStatus(item.status),
      createdAt: this.normalizeDateMs(item.createdAt),
      updatedAt: this.normalizeOptionalDateMs(item.updatedAt),
    };
  }

  private normalizeUid(value: unknown): string {
    const uid = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
  }

  private normalizeStatus(value: unknown): VideoProcessingStatus {
    return value === 'processing' || value === 'ready' || value === 'failed'
      ? value
      : 'uploaded';
  }

  private normalizeOptionalPositiveNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue >= 0
      ? Math.trunc(numberValue)
      : null;
  }

  private normalizeOptionalText(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private normalizeDateMs(value: unknown): number {
    return this.normalizeOptionalDateMs(value) ?? Date.now();
  }

  private normalizeOptionalDateMs(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.trunc(value);
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'toDate' in value &&
      typeof (value as { toDate?: unknown }).toDate === 'function'
    ) {
      try {
        return (value as { toDate: () => Date }).toDate().getTime();
      } catch {
        return null;
      }
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'seconds' in value &&
      typeof (value as { seconds?: unknown }).seconds === 'number'
    ) {
      return Number((value as { seconds: number }).seconds) * 1000;
    }

    return null;
  }

  private handleReadError(error: unknown, ownerUid: string): void {
    this.privacyDebug.log('media', 'VideoLibrary: erro ao carregar vídeos', {
      hasOwnerUid: !!ownerUid,
    });

    const normalized = error instanceof Error
      ? error
      : new Error('Erro ao carregar vídeos.');

    (normalized as any).original = error;
    (normalized as any).context = {
      scope: 'VideoLibraryService',
      op: 'watchPrivateVideos$',
      hasOwnerUid: !!ownerUid,
    };
    (normalized as any).skipUserNotification = true;

    this.globalErrorHandler.handleError(normalized);
    this.errorNotifier.showError('Erro ao carregar vídeos.');
  }
}
