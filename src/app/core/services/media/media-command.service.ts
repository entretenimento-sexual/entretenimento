// src/app/core/services/media/media-command.service.ts
// Commands reais do domínio Media (fotos).
//
// AJUSTES DESTA VERSÃO:
// - SUPRIMIDO o upload simulado com interval(...)
// - SUPRIMIDA a mutação em memória via MediaQueryService
// - upload agora delega para PhotoUploadFlowService
// - delete agora usa PhotoFirestoreService real
// - mantido o nome dos métodos públicos para reduzir impacto no restante do app
//
// OBSERVAÇÃO:
// - uploadProfilePhoto$ mantém Observable<IMediaUploadProgress>
// - como o fluxo real atual não expõe progresso granular, emitimos:
//   1) UPLOADING 0
//   2) DONE 100
// - isso é mais honesto do que simular progresso inexistente

import { Injectable } from '@angular/core';
import { Observable, concat, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

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

  /**
   * Upload real de foto do perfil.
   * Mantido o nome do método.
   */
  uploadProfilePhoto$(
    ownerUid: string,
    file: File,
    _previewUrl?: string | null
  ): Observable<IMediaUploadProgress> {
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeOwnerUid) {
      this.errorNotifier.showError('Perfil inválido para upload.');
      return of({ phase: 'DONE', progress: 0 });
    }

    if (!file?.type?.startsWith('image/')) {
      this.errorNotifier.showError('Arquivo inválido. Selecione uma imagem.');
      return of({ phase: 'DONE', progress: 0 });
    }

    const uploading$ = of<IMediaUploadProgress>({
      phase: 'UPLOADING',
      progress: 0,
    });

    const done$ = this.photoUploadFlow.uploadProcessedPhoto$({
      userId: safeOwnerUid,
      processedFile: file,
      originalFileName: file.name,
      mimeType: file.type,
    }).pipe(
      map((result) => ({
        phase: 'DONE' as const,
        progress: 100,
        photoId: result.photoId,
        downloadUrl: result.url,
      })),
      catchError((error) => {
        const normalizedError = this.normalizeError(
          error,
          'Erro ao enviar foto do perfil.',
          { op: 'uploadProfilePhoto$', ownerUid: safeOwnerUid, fileName: file.name }
        );

        this.errorHandler.handleError(normalizedError);
        this.errorNotifier.showError('Erro ao enviar foto do perfil.');

        return of<IMediaUploadProgress>({
          phase: 'DONE',
          progress: 0,
        });
      })
    );

    return concat(uploading$, done$);
  }

  /**
   * Delete real de foto do perfil.
   * Mantido o nome do método.
   */
  deleteProfilePhoto$(ownerUid: string, photoId: string): Observable<void> {
    const safeOwnerUid = (ownerUid ?? '').trim();
    const safePhotoId = (photoId ?? '').trim();

    if (!safeOwnerUid || !safePhotoId) {
      return of(void 0);
    }

    return this.photoFirestoreService.getPhotosByUser(safeOwnerUid).pipe(
      take(1),
      map((items) => items.find((photo) => (photo.id ?? '').trim() === safePhotoId) ?? null),
      switchMap((photo) => {
        if (!photo) {
          return throwError(() => new Error('Foto não encontrada para exclusão.'));
        }

        const safePath = (photo.path ?? '').trim();
        if (!safePath) {
          return throwError(() => new Error('A foto não possui storagePath válido para exclusão.'));
        }

        return from(
          this.photoFirestoreService.deletePhoto(safeOwnerUid, safePhotoId, safePath)
        );
      }),
      catchError((error) => {
        const normalizedError = this.normalizeError(
          error,
          'Erro ao excluir foto do perfil.',
          { op: 'deleteProfilePhoto$', ownerUid: safeOwnerUid, photoId: safePhotoId }
        );

        this.errorHandler.handleError(normalizedError);
        this.errorNotifier.showError('Erro ao excluir foto do perfil.');

        return of(void 0);
      })
    );
  }

  private normalizeError(
    error: unknown,
    fallbackMessage: string,
    context?: Record<string, unknown>
  ): Error {
    const normalizedError =
      error instanceof Error ? error : new Error(fallbackMessage);

    (normalizedError as any).original = error;
    (normalizedError as any).context = {
      scope: 'MediaCommandService',
      ...(context ?? {}),
    };
    (normalizedError as any).skipUserNotification = true;

    return normalizedError;
  }
}