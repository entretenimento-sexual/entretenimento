// src\app\core\services\media\photo-view-tracking.service.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export type TPhotoViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'boosted'
  | 'unknown';

interface IRecordPhotoViewRequest {
  ownerUid: string;
  photoId: string;
  source: TPhotoViewSource;
}

interface IRecordPhotoViewResponse {
  ok: true;
  ownerUid: string;
  photoId: string;
}

@Injectable({ providedIn: 'root' })
export class PhotoViewTrackingService {
  private readonly functions = inject(Functions);

  constructor(
    private readonly firestoreCtx: FirestoreContextService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  recordPhotoView$(
    ownerUid: string,
    photoId: string,
    source: TPhotoViewSource = 'unknown'
  ): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(void 0);
    }

    return this.firestoreCtx.deferPromise$(async () => {
      const callable = httpsCallable<
        IRecordPhotoViewRequest,
        IRecordPhotoViewResponse
      >(this.functions, 'recordPhotoView');

      await callable({
        ownerUid: safeOwnerUid,
        photoId: safePhotoId,
        source,
      });
    }).pipe(
      map(() => void 0),
      catchError((error: unknown) => {
        this.reportError(error, {
          op: 'recordPhotoView$',
          ownerUid: safeOwnerUid,
          photoId: safePhotoId,
          source,
        });

        return of(void 0);
      })
    );
  }

  private reportError(error: unknown, context: Record<string, unknown>): void {
    try {
      const err =
        error instanceof Error
          ? error
          : new Error('Erro ao registrar visualização da foto.');

      (err as any).original = error;
      (err as any).context = {
        scope: 'PhotoViewTrackingService',
        ...context,
      };
      (err as any).skipUserNotification = true;

      this.errorHandler.handleError(err);
    } catch {
      // noop
    }
  }
}
