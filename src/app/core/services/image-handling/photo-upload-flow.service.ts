// src/app/core/services/image-handling/photo-upload-flow.service.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { PhotoFirestoreService } from './photo-firestore.service';
import { PhotoStagingUploadService } from './photo-staging-upload.service';
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

interface RegisterAndPublishPhotoUploadRequest {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  visibility: 'PUBLIC';
  caption: null;
  isCover: false;
  orderIndex: number;
  commentsEnabled: true;
  commentsPolicy: 'EVERYONE';
  reactionsEnabled: true;
}

interface RegisterAndPublishPhotoUploadResponse {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  moderationStatus: 'PENDING_REVIEW' | 'APPROVED';
}

@Injectable({
  providedIn: 'root',
})
export class PhotoUploadFlowService {
  private readonly functions = inject(Functions);
  private readonly registerAndPublishPhotoUploadCallable = httpsCallable<
    RegisterAndPublishPhotoUploadRequest,
    RegisterAndPublishPhotoUploadResponse
  >(this.functions, 'registerAndPublishPhotoUpload');

  constructor(
    private readonly photoFirestoreService: PhotoFirestoreService,
    private readonly photoStagingUpload: PhotoStagingUploadService,
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
    const photoId = this.createPhotoId();
    const fileName = this.buildTimestampedFileName(
      command.originalFileName
    );
    const file = this.buildProcessedFile(command, fileName);
    const storagePath = this.photoStagingUpload.buildInitialPath(
      safeUserId,
      photoId
    );

    return this.photoStagingUpload.upload$(
      safeUserId,
      photoId,
      file,
      storagePath
    ).pipe(
      switchMap(() =>
        this.registerAndPublishNewPhoto$(
          safeUserId,
          photoId,
          storagePath,
          file,
          fileName,
          command.imageStateStr
        )
      ),
      catchError((error) =>
        this.failFlow$(
          error,
          'Erro ao enviar e publicar a imagem.',
          {
            op: 'uploadProcessedPhoto$',
            userId: safeUserId,
            photoId,
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
    const replacementStoragePath =
      this.photoStagingUpload.buildReplacementPath(
        safeUserId,
        safePhotoId,
        currentStoragePath
      );

    /**
     * A substituição preserva copy-on-write com dois slots fixos por foto:
     * 1) envia para o slot alternativo;
     * 2) troca os metadados;
     * 3) remove o slot anterior.
     *
     * O limite físico de dois slots impede que a edição vire armazenamento
     * arbitrário sem abrir mão de rollback seguro.
     */
    return this.photoStagingUpload.upload$(
      safeUserId,
      safePhotoId,
      file,
      replacementStoragePath
    ).pipe(
      switchMap(() =>
        this.photoStagingUpload.resolveReadableUrl$(replacementStoragePath)
      ),
      switchMap((displayUrl) => {
        const result: IPhotoFlowResult = {
          photoId: safePhotoId,
          url: displayUrl,
          path: replacementStoragePath,
          fileName,
          createdAt: new Date(),
        };

        return from(
          this.photoFirestoreService.updatePhotoMetadata(
            safeUserId,
            safePhotoId,
            {
              url: displayUrl,
              path: replacementStoragePath,
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
              replacementStoragePath,
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
    const photoId = this.createPhotoId();
    const fileName = this.buildTimestampedFileName(
      command.originalFileName
    );
    const file = this.buildProcessedFile(command, fileName);
    const storagePath = this.photoStagingUpload.buildInitialPath(
      safeUserId,
      photoId
    );

    return new Observable<IPhotoUploadFlowEvent>((observer) => {
      observer.next({ type: 'progress', progress: 0 });

      const subscription = this.photoStagingUpload.upload$(
        safeUserId,
        photoId,
        file,
        storagePath,
        (progress) => {
          observer.next({
            type: 'progress',
            progress: this.normalizeProgress(progress),
          });
        }
      ).pipe(
        switchMap(() =>
          this.registerAndPublishNewPhoto$(
            safeUserId,
            photoId,
            storagePath,
            file,
            fileName,
            command.imageStateStr
          )
        ),
        catchError((error) =>
          this.failFlow$(
            error,
            'Erro ao enviar e publicar a imagem.',
            {
              op: 'uploadProcessedPhotoWithProgress$',
              userId: safeUserId,
              photoId,
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

  private registerAndPublishNewPhoto$(
    ownerUid: string,
    photoId: string,
    storagePath: string,
    file: File,
    fileName: string,
    imageStateStr?: string
  ): Observable<IPhotoFlowResult> {
    const request: RegisterAndPublishPhotoUploadRequest = {
      ownerUid,
      photoId,
      storagePath,
      fileName,
      mimeType: file.type,
      sizeBytes: file.size,
      visibility: 'PUBLIC',
      caption: null,
      isCover: false,
      orderIndex: 0,
      commentsEnabled: true,
      commentsPolicy: 'EVERYONE',
      reactionsEnabled: true,
    };

    return from(this.registerAndPublishPhotoUploadCallable(request)).pipe(
      switchMap((response) => {
        const registered = response.data;

        return this.resolveRegisteredPhotoUrlBestEffort$(
          ownerUid,
          photoId,
          storagePath,
          fileName
        ).pipe(
          switchMap((displayUrl) =>
            this.saveImageStateBestEffort$(ownerUid, imageStateStr).pipe(
              map((): IPhotoFlowResult => ({
                photoId: registered.photoId,
                url: displayUrl,
                path: registered.storagePath,
                fileName: registered.fileName,
                createdAt: new Date(registered.createdAt),
              }))
            )
          )
        );
      }),
      catchError((registrationError) =>
        this.rollbackUploadedPhoto$(
          ownerUid,
          storagePath,
          registrationError,
          'register-and-publish-failed'
        )
      )
    );
  }

  private resolveRegisteredPhotoUrlBestEffort$(
    ownerUid: string,
    photoId: string,
    storagePath: string,
    fileName: string
  ): Observable<string> {
    return this.photoStagingUpload.resolveReadableUrl$(storagePath).pipe(
      switchMap((displayUrl) =>
        from(
          this.photoFirestoreService.updatePhotoMetadata(
            ownerUid,
            photoId,
            {
              url: displayUrl,
              path: storagePath,
              fileName,
            }
          )
        ).pipe(
          map(() => displayUrl),
          catchError((metadataError) => {
            this.reportSilent(metadataError, {
              op: 'resolveRegisteredPhotoUrlBestEffort$.metadata',
              ownerUid,
              photoId,
              hasStoragePath: true,
            });
            return of(displayUrl);
          })
        )
      ),
      catchError((urlError) => {
        this.reportSilent(urlError, {
          op: 'resolveRegisteredPhotoUrlBestEffort$.url',
          ownerUid,
          photoId,
          hasStoragePath: true,
        });

        return of('');
      })
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
