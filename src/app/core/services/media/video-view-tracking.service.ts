import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, throwError } from 'rxjs';
import { catchError, finalize, map, retry, tap } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaViewRecordingRegistry } from './media-view-recording-registry';

export type TVideoViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'boosted'
  | 'unknown';

interface RecordVideoViewRequest {
  ownerUid: string;
  videoId: string;
  source: TVideoViewSource;
}

interface RecordVideoViewResponse {
  ok: true;
  ownerUid: string;
  videoId: string;
}

@Injectable({ providedIn: 'root' })
export class VideoViewTrackingService {
  private readonly functions = inject(Functions);
  private readonly recordingRegistry = new MediaViewRecordingRegistry();

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  recordVideoView$(
    ownerUid: string,
    videoId: string,
    source: TVideoViewSource = 'unknown'
  ): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safeVideoId = (videoId ?? '').trim();

    if (!safeOwnerUid || !safeVideoId) {
      const validationError = new Error('Dados inválidos para registrar visualização do vídeo.');

      this.reportError(validationError, {
        op: 'recordVideoView$',
        hasOwnerUid: !!safeOwnerUid,
        hasVideoId: !!safeVideoId,
        source,
      });

      return throwError(() => validationError);
    }

    const viewKey = `video:${safeOwnerUid}:${safeVideoId}`;

    if (!this.recordingRegistry.tryStart(viewKey)) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<RecordVideoViewRequest, RecordVideoViewResponse>(
        this.functions,
        'recordVideoView'
      );

      await callable({
        ownerUid: safeOwnerUid,
        videoId: safeVideoId,
        source,
      });
    }).pipe(
      retry({ count: 1, delay: 250 }),
      map(() => void 0),
      tap(() => this.recordingRegistry.confirm(viewKey)),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'recordVideoView$',
          hasOwnerUid: true,
          hasVideoId: true,
          source,
        });

        return throwError(() => error);
      }),
      finalize(() => this.recordingRegistry.release(viewKey))
    );
  }

  private reportError(error: unknown, context: Record<string, unknown>): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Erro ao registrar visualização do vídeo.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'VideoViewTrackingService',
        ...context,
      };
      (normalizedError as any).skipUserNotification = true;

      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
