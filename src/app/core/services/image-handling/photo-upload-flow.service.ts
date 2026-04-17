//src\app\core\services\image-handling\photo-upload-flow.service.ts
import { Injectable } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { StorageService } from './storage.service';
import { PhotoFirestoreService } from './photo-firestore.service';
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
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
  ) {}

  uploadProcessedPhoto$(command: IPhotoUploadFlowCommand): Observable<IPhotoFlowResult> {
    const safeUserId = this.normalizeRequiredString(command.userId, 'Usuário não autenticado.');
    const fileName = this.buildTimestampedFileName(command.originalFileName);
    const file = new File([command.processedFile], fileName, {
      type: command.mimeType || 'image/jpeg',
      lastModified: Date.now(),
    });

    const expectedStoragePath = this.storageService.buildOwnedImageUploadPath(safeUserId, fileName);
    const createdAt = new Date();
    const photoId = Date.now().toString();

    return this.saveImageStateIfPresent$(safeUserId, command.imageStateStr).pipe(
      switchMap(() => this.storageService.uploadFile(file, expectedStoragePath, safeUserId)),
      switchMap((location) => this.resolveDisplayAndStorage$(location, expectedStoragePath)),
      switchMap(({ displayUrl, storagePath }) =>
        from(
          this.photoFirestoreService.savePhotoMetadata(safeUserId, {
            id: photoId,
            url: displayUrl,
            path: storagePath,
            fileName,
            createdAt,
          })
        ).pipe(
          map(() => ({
            photoId,
            url: displayUrl,
            path: storagePath,
            fileName,
            createdAt,
          }))
        )
      ),
      catchError((error) =>
        this.failFlow$(
          error,
          'Erro ao enviar a imagem.',
          { op: 'uploadProcessedPhoto$', userId: safeUserId, fileName }
        )
      )
    );
  }

  replaceProcessedPhoto$(command: IPhotoReplaceFlowCommand): Observable<IPhotoFlowResult> {
    const safeUserId = this.normalizeRequiredString(command.userId, 'Usuário não autenticado.');
    const safePhotoId = this.normalizeRequiredString(command.photoId, 'Foto inválida para edição.');
    const safeStoragePath = this.normalizeRequiredString(
      command.currentStoragePath,
      'O fluxo de edição precisa do storagePath da foto.'
    );

    if (this.isHttpUrl(safeStoragePath)) {
      return this.failFlow$(
        new Error('O fluxo de edição recebeu URL pública em vez de storagePath.'),
        'Não foi possível editar a foto selecionada.',
        { op: 'replaceProcessedPhoto$', userId: safeUserId, photoId: safePhotoId, safeStoragePath }
      );
    }

    const fileName = this.buildTimestampedFileName(command.originalFileName);
    const file = new File([command.processedFile], fileName, {
      type: command.mimeType || 'image/jpeg',
      lastModified: Date.now(),
    });

    return this.saveImageStateIfPresent$(safeUserId, command.imageStateStr).pipe(
      switchMap(() => this.storageService.replaceFile(file, safeStoragePath)),
      switchMap((location) => this.resolveDisplayAndStorage$(location, safeStoragePath)),
      switchMap(({ displayUrl, storagePath }) =>
        from(
          this.photoFirestoreService.updatePhotoMetadata(safeUserId, safePhotoId, {
            url: displayUrl,
            path: storagePath,
            fileName,
          })
        ).pipe(
          map(() => ({
            photoId: safePhotoId,
            url: displayUrl,
            path: storagePath,
            fileName,
            createdAt: new Date(),
          }))
        )
      ),
      catchError((error) =>
        this.failFlow$(
          error,
          'Erro ao atualizar a imagem.',
          { op: 'replaceProcessedPhoto$', userId: safeUserId, photoId: safePhotoId, fileName }
        )
      )
    );
  }

  private saveImageStateIfPresent$(userId: string, imageStateStr?: string): Observable<void> {
    const safeImageState = (imageStateStr ?? '').trim();
    if (!safeImageState) {
      return of(void 0);
    }

    return from(this.photoFirestoreService.saveImageState(userId, safeImageState));
  }

  private resolveDisplayAndStorage$(
    location: string,
    fallbackStoragePath: string
  ): Observable<{ displayUrl: string; storagePath: string }> {
    const safeLocation = (location ?? '').trim();
    const safeFallbackPath = (fallbackStoragePath ?? '').trim();

    if (!safeLocation) {
      return of({
        displayUrl: '',
        storagePath: safeFallbackPath,
      });
    }

    if (this.isHttpUrl(safeLocation)) {
      return of({
        displayUrl: safeLocation,
        storagePath: safeFallbackPath,
      });
    }

    return this.storageService.getPhotoUrl(safeLocation).pipe(
      map((resolvedUrl) => ({
        displayUrl: (resolvedUrl ?? '').trim() || safeLocation,
        storagePath: safeLocation,
      })),
      catchError(() =>
        of({
          displayUrl: safeLocation,
          storagePath: safeLocation,
        })
      )
    );
  }

  private buildTimestampedFileName(originalFileName: string): string {
    const safeOriginalName = (originalFileName ?? '').trim() || 'photo.jpg';
    return `${Date.now()}_${safeOriginalName}`;
  }

  private normalizeRequiredString(value: string, message: string): string {
    const normalized = (value ?? '').trim();
    if (!normalized) {
      throw new Error(message);
    }
    return normalized;
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test((value ?? '').trim());
  }

  private failFlow$(
    error: unknown,
    userMessage: string,
    context?: Record<string, unknown>
  ): Observable<never> {
    const normalizedError =
      error instanceof Error ? error : new Error(userMessage);

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

  uploadProcessedPhotoWithProgress$(
  command: IPhotoUploadFlowCommand
): Observable<IPhotoUploadFlowEvent> {
  const safeUserId = this.normalizeRequiredString(command.userId, 'Usuário não autenticado.');
  const fileName = this.buildTimestampedFileName(command.originalFileName);
  const file = new File([command.processedFile], fileName, {
    type: command.mimeType || 'image/jpeg',
    lastModified: Date.now(),
  });

  const expectedStoragePath = this.storageService.buildOwnedImageUploadPath(safeUserId, fileName);
  const createdAt = new Date();
  const photoId = Date.now().toString();

  return new Observable<IPhotoUploadFlowEvent>((observer) => {
    observer.next({ type: 'progress', progress: 0 });

    const subscription = this.saveImageStateIfPresent$(safeUserId, command.imageStateStr).pipe(
      switchMap(() =>
        this.storageService.uploadFile(
          file,
          expectedStoragePath,
          safeUserId,
          (progress) => {
            observer.next({
              type: 'progress',
              progress: Math.max(0, Math.min(100, Math.round(progress))),
            });
          }
        )
      ),
      switchMap((location) => this.resolveDisplayAndStorage$(location, expectedStoragePath)),
      switchMap(({ displayUrl, storagePath }) =>
        from(
          this.photoFirestoreService.savePhotoMetadata(safeUserId, {
            id: photoId,
            url: displayUrl,
            path: storagePath,
            fileName,
            createdAt,
          })
        ).pipe(
          map(() => ({
            photoId,
            url: displayUrl,
            path: storagePath,
            fileName,
            createdAt,
          }))
        )
      ),
      catchError((error) =>
        this.failFlow$(
          error,
          'Erro ao enviar a imagem.',
          { op: 'uploadProcessedPhotoWithProgress$', userId: safeUserId, fileName }
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
}