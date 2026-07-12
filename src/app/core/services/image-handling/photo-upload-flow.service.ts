// src/app/core/services/image-handling/photo-upload-flow.service.ts
import { Injectable } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { StorageService } from './storage.service';
import { PhotoFirestoreService } from './photo-firestore.service';
import { PhotoStorageLifecycleService } from './photo-storage-lifecycle.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

export interface IPhotoUploadFlowCommand {
  userId: string;
  processedFile: Blob;
  originalFileName: string;
  mimeType: string;
  imageStateStr?: string;
}

export interface IPhotoReplaceFlowCommand extends IPhotoUploadFlowCommand {
  photoId: string;
  currentStoragePath: string;
}

export interface IPhotoFlowResult {
  photoId: string;
  url: string;
  path: string;
  fileName: string;
  createdAt: Date;
}

export interface IPhotoUploadProgressEvent {
  type: 'progress';
  progress: number;
}

export interface IPhotoUploadSuccessEvent {
  type: 'success';
  result: IPhotoFlowResult;
}

export type IPhotoUploadFlowEvent =
  | IPhotoUploadProgressEvent
  | IPhotoUploadSuccessEvent;

@Injectable({
  providedIn: 'root',
})
export class PhotoUploadFlowService {
  constructor(
    private readonly storageService: StorageService,
    private readonly photoFirestoreService: PhotoFirestoreService,
    private readonly photoStorageLifecycle: PhotoStorageLifecycleService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
  ) {}

  uploadProcessedPhoto$(
    command: IPhotoUploadFlowCommand
  ): Observable<IPhotoFlowResult> {
    const safeUserId = this.normalizeRequiredString(
      command.userId,
      'Usuário não autenticado.'
    );
    const fileName = this.buildTimestampedFileName(
      command.originalFileName
    );
    const file = this.buildProcessedFile(command, fileName);
    const requestedStoragePath =
      this.storageService.buildOwnedImageUploadPath(safeUserId, fileName);
    const resultBase = {
      photoId: this.createPhotoId(),
      fileName,
      createdAt: new Date(),
    };

    return this.uploadNewPhotoBinary$(
      safeUserId,
      file,
      requestedStoragePath
    ).pipe(
      switchMap(({ displayUrl, storagePath }) => {
        const result: IPhotoFlowResult = {
          ...resultBase,
          url: displayUrl,
          path: storagePath,
        };

        return this.persistNewPhoto$(
          safeUserId,
          result,
          command.imageStateStr
        );
      }),
      catchError((error) =>
        this.failFlow$(
          error,
          'Erro ao enviar a imagem.',
          {
            op: 'uploadProcessedPhoto$',
            userId: safeUserId,
            fileName,
          }
        )
      )
    );
  }

  replaceProcessedPhoto$(
    command: IPhotoReplaceFlowCommand
  ): Observable<IPhotoFlowResult> {
    const safeUserId = this.normalizeRequiredString(
      command.userId,
      'Usuário não autenticado.'
    );
    const safePhotoId = this.normalizeRequiredString(
      command.photoId,
      'Foto inválida para edição.'
    );
    const safeCurrentStoragePath = this.normalizeRequiredString(
      command.currentStoragePath,
      'O fluxo de edição precisa do storagePath da foto.'
    );
    const currentStoragePath =
      this.photoStorageLifecycle.extractOwnedPrivatePhotoPath(
        safeUserId,
        safeCurrentStoragePath
      );

    if (!currentStoragePath) {
      return this.failFlow$(
        new Error('O fluxo de edição recebeu um storagePath inválido.'),
        'Não foi possível editar a foto selecionada.',
        {
          op: 'replaceProcessedPhoto$',
          userId: safeUserId,
          photoId: safePhotoId,
          hasStoragePath: !!safeCurrentStoragePath,
        }
      );
    }

    const fileName = this.buildTimestampedFileName(
      command.originalFileName
    );
    const file = this.buildProcessedFile(command, fileName);
    const requestedStoragePath =
      this.storageService.buildOwnedImageUploadPath(safeUserId, fileName);

    /**
     * A substituição usa copy-on-write:
     * 1) envia um novo objeto;
     * 2) troca os metadados;
     * 3) remove o objeto antigo.
     *
     * Isso evita sobrescrever a única cópia válida antes de o Firestore aceitar
     * os novos metadados.
     */
    return this.uploadNewPhotoBinary$(
      safeUserId,
      file,
      requestedStoragePath
    ).pipe(
      switchMap(({ displayUrl, storagePath }) => {
        const result: IPhotoFlowResult = {
          photoId: safePhotoId,
          url: displayUrl,
          path: storagePath,
          fileName,
          createdAt: new Date(),
        };

        return from(
          this.photoFirestoreService.updatePhotoMetadata(
            safeUserId,
            safePhotoId,
            {
              url: displayUrl,
              path: storagePath,
              fileName,
            }
          )
        ).pipe(
          switchMap(() =>
            this.saveImageStateBestEffort$(
              safeUserId,
              command.imageStateStr
            )
          ),
          switchMap(() =>
            this.deletePhotoObjectBestEffort$(
              safeUserId,
              currentStoragePath,
              'cleanup-replaced-photo'
            )
          ),
          map(() => result),
          catchError((metadataError) =>
            this.rollbackUploadedPhoto$(
              safeUserId,
              storagePath,
              metadataError,
              'replace-metadata-failed'
            )
          )
        );
      }),
      catchError((error) =>
        this.failFlow$(
          error,
          'Erro ao atualizar a imagem.',
          {
            op: 'replaceProcessedPhoto$',
            userId: safeUserId,
            photoId: safePhotoId,
            fileName,
          }
        )
      )
    );
  }

  uploadProcessedPhotoWithProgress$(
    command: IPhotoUploadFlowCommand
  ): Observable<IPhotoUploadFlowEvent> {
    const safeUserId = this.normalizeRequiredString(
      command.userId,
      'Usuário não autenticado.'
    );
    const fileName = this.buildTimestampedFileName(
      command.originalFileName
    );
    const file = this.buildProcessedFile(command, fileName);
    const requestedStoragePath =
      this.storageService.buildOwnedImageUploadPath(safeUserId, fileName);
    const resultBase = {
      photoId: this.createPhotoId(),
      fileName,
      createdAt: new Date(),
    };

    return new Observable<IPhotoUploadFlowEvent>((observer) => {
      observer.next({ type: 'progress', progress: 0 });

      const subscription = this.uploadNewPhotoBinary$(
        safeUserId,
        file,
        requestedStoragePath,
        (progress) => {
          observer.next({
            type: 'progress',
            progress: this.normalizeProgress(progress),
          });
        }
      ).pipe(
        switchMap(({ displayUrl, storagePath }) => {
          const result: IPhotoFlowResult = {
            ...resultBase,
            url: displayUrl,
            path: storagePath,
          };

          return this.persistNewPhoto$(
            safeUserId,
            result,
            command.imageStateStr
          );
        }),
        catchError((error) =>
          this.failFlow$(
            error,
            'Erro ao enviar a imagem.',
            {
              op: 'uploadProcessedPhotoWithProgress$',
              userId: safeUserId,
              fileName,
            }
          )
        )
      ).subscribe({
        next: (result) => {
          observer.next({ type: 'progress', progress: 100 });
          observer.next({ type: 'success', result });
          observer.complete();
        },
        error: (error) => observer.error(error),
      });

      return () => subscription.unsubscribe();
    });
  }

  private uploadNewPhotoBinary$(
    userId: string,
    file: File,
    requestedStoragePath: string,
    progressCallback?: (progress: number) => void
  ): Observable<{ displayUrl: string; storagePath: string }> {
    return this.storageService.uploadFile(
      file,
      requestedStoragePath,
      userId,
      progressCallback
    ).pipe(
      switchMap((location) =>
        this.resolveDisplayAndStorage$(userId, location)
      )
    );
  }

  private persistNewPhoto$(
    userId: string,
    result: IPhotoFlowResult,
    imageStateStr?: string
  ): Observable<IPhotoFlowResult> {
    return from(
      this.photoFirestoreService.savePhotoMetadata(userId, {
        id: result.photoId,
        url: result.url,
        path: result.path,
        fileName: result.fileName,
        createdAt: result.createdAt,
      })
    ).pipe(
      switchMap(() =>
        this.saveImageStateBestEffort$(userId, imageStateStr)
      ),
      map(() => result),
      catchError((metadataError) =>
        this.rollbackUploadedPhoto$(
          userId,
          result.path,
          metadataError,
          'create-metadata-failed'
        )
      )
    );
  }

  private saveImageStateBestEffort$(
    userId: string,
    imageStateStr?: string
  ): Observable<void> {
    const safeImageState = String(imageStateStr ?? '').trim();

    if (!safeImageState) {
      return of(void 0);
    }

    return from(
      this.photoFirestoreService.saveImageState(
        userId,
        safeImageState
      )
    ).pipe(
      catchError((error) => {
        this.reportSilent(error, {
          op: 'saveImageStateBestEffort$',
          userId,
        });
        return of(void 0);
      })
    );
  }

  private resolveDisplayAndStorage$(
    userId: string,
    location: string
  ): Observable<{ displayUrl: string; storagePath: string }> {
    const safeLocation = String(location ?? '').trim();
    const storagePath =
      this.photoStorageLifecycle.extractOwnedPrivatePhotoPath(
        userId,
        safeLocation
      );

    if (!safeLocation || !storagePath) {
      return throwError(() =>
        this.createError(
          'media/invalid-upload-location',
          'O upload terminou sem um caminho de armazenamento válido.'
        )
      );
    }

    if (this.isHttpUrl(safeLocation)) {
      return of({
        displayUrl: safeLocation,
        storagePath,
      });
    }

    return this.storageService.getPhotoUrl(storagePath).pipe(
      switchMap((resolvedUrl) => {
        const displayUrl = String(resolvedUrl ?? '').trim();

        if (!this.isHttpUrl(displayUrl)) {
          return throwError(() =>
            this.createError(
              'media/photo-url-unavailable',
              'A foto foi enviada, mas não pôde ser carregada com segurança.'
            )
          );
        }

        return of({
          displayUrl,
          storagePath,
        });
      })
    );
  }

  private rollbackUploadedPhoto$(
    userId: string,
    storagePath: string,
    originalError: unknown,
    reason: string
  ): Observable<never> {
    return this.deletePhotoObjectBestEffort$(
      userId,
      storagePath,
      reason
    ).pipe(
      switchMap(() => throwError(() => originalError))
    );
  }

  private deletePhotoObjectBestEffort$(
    userId: string,
    storagePath: string,
    reason: string
  ): Observable<void> {
    return this.photoStorageLifecycle
      .deleteOwnedPrivatePhoto$(userId, storagePath)
      .pipe(
        catchError((cleanupError) => {
          this.reportSilent(cleanupError, {
            op: 'deletePhotoObjectBestEffort$',
            userId,
            reason,
            hasStoragePath: !!String(storagePath ?? '').trim(),
          });
          return of(void 0);
        })
      );
  }

  private buildProcessedFile(
    command: IPhotoUploadFlowCommand,
    fileName: string
  ): File {
    return new File([command.processedFile], fileName, {
      type: command.mimeType || 'image/jpeg',
      lastModified: Date.now(),
    });
  }

  private buildTimestampedFileName(originalFileName: string): string {
    const safeOriginalName = String(originalFileName ?? '').trim() || 'photo.jpg';
    return `${Date.now()}_${safeOriginalName}`;
  }

  private createPhotoId(): string {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private normalizeProgress(progress: number): number {
    if (!Number.isFinite(progress)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  private normalizeRequiredString(value: string, message: string): string {
    const normalized = String(value ?? '').trim();

    if (!normalized) {
      throw new Error(message);
    }

    return normalized;
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(String(value ?? '').trim());
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    return error;
  }

  private reportSilent(
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('[PhotoUploadFlowService] Falha secundária.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'PhotoUploadFlowService',
        ...(context ?? {}),
      };
      (normalizedError as any).silent = true;
      (normalizedError as any).skipUserNotification = true;

      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }

  private failFlow$(
    error: unknown,
    userMessage: string,
    context?: Record<string, unknown>
  ): Observable<never> {
    const normalizedError = error instanceof Error
      ? error
      : new Error(userMessage);

    (normalizedError as any).original = error;
    (normalizedError as any).context = {
      scope: 'PhotoUploadFlowService',
      ...(context ?? {}),
    };
    (normalizedError as any).skipUserNotification = true;

    this.errorHandler.handleError(normalizedError);
    this.errorNotifier.showError(userMessage);

    return throwError(() => normalizedError);
  }
}
