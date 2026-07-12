// src/app/core/services/media/media-command.service.ts
import { Injectable } from '@angular/core';
import { Observable, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoUploadFlowService } from 'src/app/core/services/image-handling/photo-upload-flow.service';
import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';

export type UploadPhase = 'UPLOADING' | 'DONE';

export interface IMediaUploadProgress {
  phase: UploadPhase;
  progress: number;
  photoId?: string;
  downloadUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class MediaCommandService {
  constructor(
    private readonly errorNotifier: ErrorNotificationService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly photoUploadFlow: PhotoUploadFlowService,
    private readonly photoFirestoreService: PhotoFirestoreService
  ) {}

  uploadProfilePhoto$(
    ownerUid: string,
    file: File,
    _previewUrl?: string | null
  ): Observable<IMediaUploadProgress> {
    const safeOwnerUid = String(ownerUid ?? '').trim();

    if (!safeOwnerUid) {
      return this.failCommand$(
        new Error('Perfil inválido para upload.'),
        'Perfil inválido para upload.',
        { op: 'uploadProfilePhoto$' }
      );
    }

    if (!file || !file.type?.startsWith('image/')) {
      return this.failCommand$(
        new Error('Arquivo de imagem inválido.'),
        'Arquivo inválido. Selecione uma imagem.',
        {
          op: 'uploadProfilePhoto$',
          ownerUid: safeOwnerUid,
        }
      );
    }

    return this.photoUploadFlow.uploadProcessedPhotoWithProgress$({
      userId: safeOwnerUid,
      processedFile: file,
      originalFileName: file.name,
      mimeType: file.type,
    }).pipe(
      map((event): IMediaUploadProgress => {
        if (event.type === 'progress') {
          return {
            phase: 'UPLOADING',
            progress: event.progress,
          };
        }

        return {
          phase: 'DONE',
          progress: 100,
          photoId: event.result.photoId,
          downloadUrl: event.result.url,
        };
      }),
      catchError((error) => {
        this.reportSilent(error, {
          op: 'uploadProfilePhoto$',
          ownerUid: safeOwnerUid,
          hasFile: !!file,
          mimeType: file.type,
          sizeBytes: file.size,
        });

        return throwError(() => error);
      })
    );
  }

  deleteProfilePhoto$(
    ownerUid: string,
    photoId: string
  ): Observable<void> {
    const safeOwnerUid = String(ownerUid ?? '').trim();
    const safePhotoId = String(photoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return this.failCommand$(
        new Error('Foto inválida para exclusão.'),
        'Foto inválida para exclusão.',
        {
          op: 'deleteProfilePhoto$',
          hasOwnerUid: !!safeOwnerUid,
          hasPhotoId: !!safePhotoId,
        }
      );
    }

    return from(
      this.photoFirestoreService.deletePhoto(
        safeOwnerUid,
        safePhotoId,
        ''
      )
    ).pipe(
      catchError((error) => {
        this.reportSilent(error, {
          op: 'deleteProfilePhoto$',
          ownerUid: safeOwnerUid,
          photoId: safePhotoId,
        });

        this.errorNotifier.showError(
          'Erro ao excluir foto do perfil.'
        );

        return throwError(() => error);
      })
    );
  }

  private failCommand$<T>(
    error: unknown,
    userMessage: string,
    context?: Record<string, unknown>
  ): Observable<T> {
    const normalizedError = error instanceof Error
      ? error
      : new Error(userMessage);

    (normalizedError as any).context = {
      scope: 'MediaCommandService',
      ...(context ?? {}),
    };
    (normalizedError as any).original = error;
    (normalizedError as any).skipUserNotification = true;

    this.errorHandler.handleError(normalizedError);
    this.errorNotifier.showError(userMessage);

    return throwError(() => normalizedError);
  }

  private reportSilent(
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('[MediaCommandService] Falha no comando de mídia.');

      (normalizedError as any).context = {
        scope: 'MediaCommandService',
        ...(context ?? {}),
      };
      (normalizedError as any).original = error;
      (normalizedError as any).silent = true;
      (normalizedError as any).skipUserNotification = true;

      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
