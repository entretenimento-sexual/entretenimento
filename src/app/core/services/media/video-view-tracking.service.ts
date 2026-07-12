import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

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
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        RecordVideoViewRequest,
        RecordVideoViewResponse
      >(this.functions, 'recordVideoView');

      await callable({
        ownerUid: safeOwnerUid,
        videoId: safeVideoId,
        source,
      });
    }).pipe(
      map(() => void 0),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'recordVideoView$',
          hasOwnerUid: true,
          hasVideoId: true,
          source,
        });

        return of(void 0);
      })
    );
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
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
