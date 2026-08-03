// src/app/core/services/image-handling/photo-upload-flow.service.ts
import { Injectable } from '@angular/core';
import type { UploadTask } from 'firebase/storage';
import {
  Observable,
  firstValueFrom,
  from,
  of,
  throwError,
} from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import {
  PrivateMediaDraftCapacityError,
  PrivateMediaDraftCapacityService,
} from '../media/private-media-draft-capacity.service';
import {
  PrivateMediaReservedUploadService,
} from '../media/private-media-reserved-upload.service';
import {
  PrivatePhotoUploadRegistrationService,
} from '../media/private-photo-upload-registration.service';
import { PhotoFirestoreService } from './photo-firestore.service';
import { PhotoStorageLifecycleService } from './photo-storage-lifecycle.service';
import { StorageService } from './storage.service';

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
  sizeBytes?: number;
  draftExpiresAt?: number | null;
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

type PhotoUploadOperation = 'CREATE' | 'REPLACE';

interface ReservedPhotoFlowCommand {
  userId: string;
  photoId: string;
  operation: PhotoUploadOperation;
  file: File;
  fileName: string;
  requestedStoragePath: string;
  currentStoragePath?: string | null;
  imageStateStr?: string;
  onProgress?: (progress: number) => void;
}

@Injectable({
  providedIn: 'root',
})
export class PhotoUploadFlowService {
  constructor(
    private readonly storageService: StorageService,
    private readonly photoFirestoreService: PhotoFirestoreService,
    private readonly photoStorageLifecycle: PhotoStorageLifecycleService,
    private readonly draftCapacity: PrivateMediaDraftCapacityService,
    private readonly reservedUpload: PrivateMediaReservedUploadService,
    private readonly photoRegistration: PrivatePhotoUploadRegistrationService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
  ) {}

  uploadProcessedPhoto$(
    command: IPhotoUploadFlowCommand
  ): Observable<IPhotoFlowResult> {
    const prepared = this.prepareCreateCommand(command);

    return this.executeReservedPhotoFlow$(prepared).pipe(
      catchError((error) =>
        this.failFlow$(
          error,
          this.resolveUserMessage(error, 'Erro ao enviar a imagem.'),
          {
            op: 'uploadProcessedPhoto$',
            userId: prepared.userId,
            photoId: prepared.photoId,
            fileName: prepared.fileName,
          }
        )
      )
    );
  }

  replaceProcessedPhoto$(
    command: IPhotoReplaceFlowCommand
  ): Observable<IPhotoFlowResult> {
    const prepared = this.prepareReplaceCommand(command);

    return this.executeReservedPhotoFlow$(prepared).pipe(
      catchError((error) =>
        this.failFlow$(
          error,
          this.resolveUserMessage(error, 'Erro ao atualizar a imagem.'),
          {
            op: 'replaceProcessedPhoto$',
            userId: prepared.userId,
            photoId: prepared.photoId,
            fileName: prepared.fileName,
          }
        )
      )
    );
  }

  uploadProcessedPhotoWithProgress$(
    command: IPhotoUploadFlowCommand
  ): Observable<IPhotoUploadFlowEvent> {
    const prepared = this.prepareCreateCommand(command);

    return new Observable<IPhotoUploadFlowEvent>((observer) => {
      observer.next({ type: 'progress', progress: 0 });

      const subscription = this.executeReservedPhotoFlow$({
        ...prepared,
        onProgress: (progress) => {
          observer.next({
            type: 'progress',
            progress: this.normalizeProgress(progress),
          });
        },
      }).pipe(
        catchError((error) =>
          this.failFlow$(
            error,
            this.resolveUserMessage(error, 'Erro ao enviar a imagem.'),
            {
              op: 'uploadProcessedPhotoWithProgress$',
              userId: prepared.userId,
              photoId: prepared.photoId,
              fileName: prepared.fileName,
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

  private executeReservedPhotoFlow$(
    command: ReservedPhotoFlowCommand
  ): Observable<IPhotoFlowResult> {
    return new Observable<IPhotoFlowResult>((observer) => {
      let reservationId = '';
      let activeTask: UploadTask | null = null;
      let cancelRequested = false;
      let registrationStarted = false;
      let completed = false;
      let cleanupPromise: Promise<void> | null = null;

      const cancelReservation = (): Promise<void> => {
        if (cleanupPromise) {
          return cleanupPromise;
        }

        const activeReservationId = reservationId;

        if (!activeReservationId) {
          return Promise.resolve();
        }

        reservationId = '';
        cleanupPromise = firstValueFrom(
          this.draftCapacity.cancelUploadReservation$(activeReservationId)
        ).then(() => undefined).catch((cleanupError) => {
          this.reportSilent(cleanupError, {
            op: 'cancelReservation',
            userId: command.userId,
            photoId: command.photoId,
            operation: command.operation,
          });
        });

        return cleanupPromise;
      };

      const assertNotCancelled = async (): Promise<void> => {
        if (!cancelRequested) {
          return;
        }

        await cancelReservation();
        throw this.createError(
          'media/photo-upload-cancelled',
          'Upload de foto cancelado.'
        );
      };

      const run = async (): Promise<void> => {
        try {
          command.onProgress?.(2);
          const reservation = await firstValueFrom(
            this.draftCapacity.reserveUpload$({
              ownerUid: command.userId,
              mediaId: command.photoId,
              kind: 'photo',
              operation: command.operation,
              sourceStoragePath: command.requestedStoragePath,
              currentStoragePath: command.currentStoragePath ?? null,
              sourceSizeBytes: command.file.size,
              auxiliarySizeBytes: 0,
            })
          );
          reservationId = reservation.reservationId;
          await assertNotCancelled();

          command.onProgress?.(5);
          const binary = await firstValueFrom(
            this.reservedUpload.upload$(
              command.requestedStoragePath,
              command.file,
              command.file.type,
              reservationId,
              (progress) => {
                command.onProgress?.(
                  this.mapProgress(progress, 5, 90)
                );
              },
              (task) => {
                activeTask = task;
              }
            )
          );
          activeTask = null;
          await assertNotCancelled();

          const displayUrl = await firstValueFrom(
            this.resolveDisplayUrl$(
              command.userId,
              binary.storagePath,
              binary.displayLocation
            )
          );
          await assertNotCancelled();

          command.onProgress?.(94);
          registrationStarted = true;

          const result = command.operation === 'CREATE'
            ? await this.registerNewPhoto(
              command,
              reservationId,
              binary.storagePath,
              displayUrl,
              reservation.draftExpiresAt
            )
            : await this.registerReplacement(
              command,
              reservationId,
              binary.storagePath,
              displayUrl
            );

          completed = true;
          reservationId = '';
          command.onProgress?.(98);

          await firstValueFrom(
            this.saveImageStateBestEffort$(
              command.userId,
              command.imageStateStr
            )
          );

          if (!observer.closed) {
            observer.next(result);
            observer.complete();
          }
        } catch (error) {
          activeTask = null;

          if (!registrationStarted) {
            await cancelReservation();
          }

          if (
            cancelRequested ||
            this.isCancellationError(error) ||
            observer.closed
          ) {
            return;
          }

          observer.error(error);
        }
      };

      void run();

      return () => {
        if (completed || registrationStarted) {
          return;
        }

        cancelRequested = true;
        activeTask?.cancel();
        void cancelReservation();
      };
    });
  }

  private async registerNewPhoto(
    command: ReservedPhotoFlowCommand,
    reservationId: string,
    storagePath: string,
    displayUrl: string,
    reservedDraftExpiresAt: number | null
  ): Promise<IPhotoFlowResult> {
    const registration = await firstValueFrom(
      this.photoRegistration.register$({
        ownerUid: command.userId,
        photoId: command.photoId,
        reservationId,
        storagePath,
        displayUrl,
        fileName: command.fileName,
        sizeBytes: command.file.size,
        createdAt: Date.now(),
      })
    );

    return {
      photoId: registration.photoId,
      url: registration.displayUrl,
      path: registration.storagePath,
      fileName: registration.fileName,
      createdAt: new Date(registration.createdAt),
      sizeBytes: registration.sizeBytes,
      draftExpiresAt:
        registration.draftExpiresAt ?? reservedDraftExpiresAt,
    };
  }

  private async registerReplacement(
    command: ReservedPhotoFlowCommand,
    reservationId: string,
    storagePath: string,
    displayUrl: string
  ): Promise<IPhotoFlowResult> {
    const currentStoragePath = this.normalizeRequiredString(
      command.currentStoragePath,
      'O fluxo de edição precisa da foto privada atual.'
    );
    const registration = await firstValueFrom(
      this.photoRegistration.replace$({
        ownerUid: command.userId,
        photoId: command.photoId,
        reservationId,
        currentStoragePath,
        newStoragePath: storagePath,
        newDisplayUrl: displayUrl,
        fileName: command.fileName,
        sizeBytes: command.file.size,
      })
    );

    return {
      photoId: registration.photoId,
      url: registration.displayUrl,
      path: registration.storagePath,
      fileName: registration.fileName,
      createdAt: new Date(registration.updatedAt),
      sizeBytes: registration.sizeBytes,
    };
  }

  private prepareCreateCommand(
    command: IPhotoUploadFlowCommand
  ): ReservedPhotoFlowCommand {
    const userId = this.normalizeRequiredString(
      command.userId,
      'Usuário não autenticado.'
    );
    const photoId = this.createPhotoId();
    const fileName = this.buildTimestampedFileName(
      command.originalFileName,
      photoId
    );
    const file = this.buildProcessedFile(command, fileName);

    return {
      userId,
      photoId,
      operation: 'CREATE',
      file,
      fileName,
      requestedStoragePath:
        this.storageService.buildOwnedImageUploadPath(userId, fileName),
      currentStoragePath: null,
      imageStateStr: command.imageStateStr,
    };
  }

  private prepareReplaceCommand(
    command: IPhotoReplaceFlowCommand
  ): ReservedPhotoFlowCommand {
    const userId = this.normalizeRequiredString(
      command.userId,
      'Usuário não autenticado.'
    );
    const photoId = this.normalizeRequiredString(
      command.photoId,
      'Foto inválida para edição.'
    );
    const suppliedCurrentPath = this.normalizeRequiredString(
      command.currentStoragePath,
      'O fluxo de edição precisa do storagePath da foto.'
    );
    const currentStoragePath =
      this.photoStorageLifecycle.extractOwnedPrivatePhotoPath(
        userId,
        suppliedCurrentPath
      );

    if (!currentStoragePath) {
      throw this.createError(
        'media/invalid-current-photo-path',
        'O fluxo de edição recebeu um storagePath inválido.'
      );
    }

    const fileName = this.buildTimestampedFileName(
      command.originalFileName,
      photoId
    );
    const file = this.buildProcessedFile(command, fileName);

    return {
      userId,
      photoId,
      operation: 'REPLACE',
      file,
      fileName,
      requestedStoragePath:
        this.storageService.buildOwnedImageUploadPath(userId, fileName),
      currentStoragePath,
      imageStateStr: command.imageStateStr,
    };
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

  private resolveDisplayUrl$(
    userId: string,
    storagePath: string,
    displayLocation: string
  ): Observable<string> {
    const safeStoragePath =
      this.photoStorageLifecycle.extractOwnedPrivatePhotoPath(
        userId,
        storagePath
      );

    if (!safeStoragePath) {
      return throwError(() =>
        this.createError(
          'media/invalid-upload-location',
          'O upload terminou sem um caminho de armazenamento válido.'
        )
      );
    }

    const safeDisplayLocation = String(displayLocation ?? '').trim();

    if (this.isHttpUrl(safeDisplayLocation)) {
      return of(safeDisplayLocation);
    }

    return this.storageService.getPhotoUrl(safeStoragePath).pipe(
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

        return of(displayUrl);
      })
    );
  }

  private buildProcessedFile(
    command: IPhotoUploadFlowCommand,
    fileName: string
  ): File {
    const file = new File([command.processedFile], fileName, {
      type: command.mimeType || 'image/jpeg',
      lastModified: Date.now(),
    });

    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw new Error('A imagem processada está vazia ou inválida.');
    }

    return file;
  }

  private buildTimestampedFileName(
    originalFileName: string,
    photoId: string
  ): string {
    const safeOriginalName = String(originalFileName ?? '')
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .slice(-120) || 'photo.jpg';
    const safePhotoId = String(photoId ?? '').trim().slice(0, 64);

    return `${Date.now()}_${safePhotoId}_${safeOriginalName}`;
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

  private mapProgress(
    progress: number,
    start: number,
    end: number
  ): number {
    const normalized = this.normalizeProgress(progress) / 100;
    return this.normalizeProgress(start + normalized * (end - start));
  }

  private normalizeProgress(progress: number): number {
    if (!Number.isFinite(progress)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  private normalizeRequiredString(
    value: string | null | undefined,
    message: string
  ): string {
    const normalized = String(value ?? '').trim();

    if (!normalized) {
      throw new Error(message);
    }

    return normalized;
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(String(value ?? '').trim());
  }

  private isCancellationError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }

    const code = String((error as { code?: unknown }).code ?? '');
    return code === 'storage/canceled' ||
      code === 'media/photo-upload-cancelled';
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    return error;
  }

  private resolveUserMessage(error: unknown, fallback: string): string {
    if (error instanceof PrivateMediaDraftCapacityError) {
      return error.message;
    }

    const message = error instanceof Error
      ? String(error.message ?? '').trim()
      : '';

    return message || fallback;
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
      // A telemetria não pode substituir o fluxo principal.
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
