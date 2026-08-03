import { Injectable, inject } from '@angular/core';
import { Storage } from '@angular/fire/storage';
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from 'firebase/storage';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export interface PrivateMediaReservedUploadResult {
  storagePath: string;
  displayLocation: string;
}

@Injectable({ providedIn: 'root' })
export class PrivateMediaReservedUploadService {
  private readonly storage = inject(Storage);
  private readonly errorHandler = inject(GlobalErrorHandlerService);

  upload$(
    storagePath: string,
    data: Blob,
    contentType: string,
    reservationId: string,
    onProgress?: (progress: number) => void,
    registerTask?: (task: UploadTask) => void
  ): Observable<PrivateMediaReservedUploadResult> {
    const safePath = String(storagePath ?? '').trim();
    const safeReservationId = String(reservationId ?? '').trim();

    if (!safePath || !safeReservationId) {
      return throwError(() =>
        new Error('A reserva do upload está incompleta.')
      );
    }

    return new Observable<string>((observer) => {
      const storageRef = ref(this.storage, safePath);
      const task = uploadBytesResumable(storageRef, data, {
        contentType,
        cacheControl: 'private, max-age=0, no-store, no-transform',
        customMetadata: {
          mediaReservationId: safeReservationId,
        },
      });
      let settled = false;

      registerTask?.(task);
      const unsubscribe = task.on(
        'state_changed',
        (snapshot) => {
          const progress = snapshot.totalBytes > 0
            ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            : 0;
          onProgress?.(this.normalizeProgress(progress));
        },
        (error) => {
          settled = true;
          observer.error(error);
        },
        () => {
          settled = true;
          observer.next(safePath);
          observer.complete();
        }
      );

      return () => {
        unsubscribe();

        if (!settled) {
          task.cancel();
        }
      };
    }).pipe(
      switchMap((uploadedPath) =>
        from(getDownloadURL(ref(this.storage, uploadedPath))).pipe(
          catchError(() => of(uploadedPath)),
          switchMap((displayLocation) => of({
            storagePath: uploadedPath,
            displayLocation,
          }))
        )
      ),
      catchError((error) => {
        this.reportError(error, {
          op: 'upload$',
          hasStoragePath: !!safePath,
          hasReservationId: true,
          sizeBytes: Number(data?.size ?? 0),
          contentType,
        });
        return throwError(() => error);
      })
    );
  }

  private normalizeProgress(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha no upload reservado de mídia.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PrivateMediaReservedUploadService',
        ...context,
      };
      (normalized as any).skipUserNotification = true;
      this.errorHandler.handleError(normalized);
    } catch {
      // A telemetria não pode substituir o erro de upload.
    }
  }
}
