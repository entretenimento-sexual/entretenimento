import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, doc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Storage } from '@angular/fire/storage';
import {
  deleteObject,
  ref,
  type UploadTask,
  uploadBytesResumable,
} from 'firebase/storage';
import { Observable, firstValueFrom } from 'rxjs';

import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { VideoMetadataPreparationService } from './video-metadata-preparation.service';

export type VideoUploadProgressPhase =
  | 'preparing'
  | 'uploading-video'
  | 'uploading-poster'
  | 'saving';

export interface IVideoUploadProgressEvent {
  type: 'progress';
  phase: VideoUploadProgressPhase;
  progress: number;
}

export interface IVideoUploadSuccessEvent {
  type: 'success';
  result: IVideoItem;
}

export type IVideoUploadFlowEvent =
  | IVideoUploadProgressEvent
  | IVideoUploadSuccessEvent;

export interface IVideoUploadCommand {
  ownerUid: string;
  file: File;
}

interface UploadedBinary {
  path: string;
}

interface RegisterPrivateVideoUploadRequest {
  ownerUid: string;
  videoId: string;
  videoStoragePath: string;
  posterStoragePath: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
}

interface RegisterPrivateVideoUploadResponse {
  videoId: string;
  ownerUid: string;
  status: 'uploaded' | 'ready';
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  videoStoragePath: string;
  posterStoragePath: string | null;
  createdAt: number;
}

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

class VideoUploadCancelledError extends Error {
  readonly code = 'media/video-upload-cancelled';

  constructor() {
    super('Upload de vídeo cancelado.');
  }
}

@Injectable({ providedIn: 'root' })
export class VideoUploadFlowService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly storage = inject(Storage);
  private readonly metadataPreparation = inject(VideoMetadataPreparationService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

  uploadPrivateVideo$(
    command: IVideoUploadCommand
  ): Observable<IVideoUploadFlowEvent> {
    return new Observable<IVideoUploadFlowEvent>((observer) => {
      let ownerUid = '';
      let file: File;

      try {
        ownerUid = this.requireOwnedUid(command.ownerUid);
        file = this.validateFile(command.file);
      } catch (error) {
        this.reportError(error, {
          op: 'uploadPrivateVideo$.validate',
          hasOwnerUid: !!String(command.ownerUid ?? '').trim(),
          hasFile: !!command.file,
        });
        observer.error(error);
        return undefined;
      }

      const videoRef = doc(collection(this.firestore, `users/${ownerUid}/videos`));
      const videoId = videoRef.id;
      const videoPath = this.buildVideoPath(ownerUid, videoId, file);
      let posterPath: string | null = null;
      let activeTask: UploadTask | null = null;
      let cancelRequested = false;
      let registrationStarted = false;
      let completed = false;
      let cleanupChain = Promise.resolve();
      let videoUploadStarted = false;
      let posterUploadStarted = false;

      const scheduleCleanup = (): Promise<void> => {
        cleanupChain = cleanupChain.then(async () => {
          const cleanupTasks: Promise<void>[] = [];

          if (posterUploadStarted && posterPath) {
            cleanupTasks.push(
              this.deleteBinaryBestEffort(posterPath, 'poster')
            );
            posterUploadStarted = false;
          }

          if (videoUploadStarted) {
            cleanupTasks.push(
              this.deleteBinaryBestEffort(videoPath, 'video')
            );
            videoUploadStarted = false;
          }

          await Promise.all(cleanupTasks);
        });

        return cleanupChain;
      };

      const assertNotCancelled = (): void => {
        if (cancelRequested) {
          throw new VideoUploadCancelledError();
        }
      };

      const run = async (): Promise<void> => {
        try {
          observer.next({ type: 'progress', phase: 'preparing', progress: 2 });

          const metadata = await firstValueFrom(
            this.metadataPreparation.prepare$(file)
          );
          assertNotCancelled();

          observer.next({ type: 'progress', phase: 'preparing', progress: 6 });
          videoUploadStarted = true;

          const videoBinary = await this.uploadBinary(
            videoPath,
            file,
            file.type,
            (task) => {
              activeTask = task;
            },
            (progress) => {
              observer.next({
                type: 'progress',
                phase: 'uploading-video',
                progress: this.mapProgress(progress, 6, 86),
              });
            }
          );
          activeTask = null;
          assertNotCancelled();

          let posterBinary: UploadedBinary | null = null;

          if (metadata.posterBlob && metadata.posterMimeType) {
            posterPath = this.buildPosterPath(ownerUid, videoId);
            posterUploadStarted = true;
            posterBinary = await this.uploadBinary(
              posterPath,
              metadata.posterBlob,
              metadata.posterMimeType,
              (task) => {
                activeTask = task;
              },
              (progress) => {
                observer.next({
                  type: 'progress',
                  phase: 'uploading-poster',
                  progress: this.mapProgress(progress, 86, 96),
                });
              }
            );
            activeTask = null;
            assertNotCancelled();
          }

          observer.next({ type: 'progress', phase: 'saving', progress: 98 });
          assertNotCancelled();
          registrationStarted = true;

          const fileName = this.normalizeDisplayFileName(file.name);
          const registration = await this.registerUploadedVideo({
            ownerUid,
            videoId,
            videoStoragePath: videoBinary.path,
            posterStoragePath: posterBinary?.path ?? null,
            fileName,
            mimeType: file.type,
            sizeBytes: file.size,
            durationMs: metadata.durationMs,
          });

          completed = true;
          observer.next({ type: 'progress', phase: 'saving', progress: 100 });
          observer.next({
            type: 'success',
            result: {
              id: registration.videoId,
              ownerUid: registration.ownerUid,
              url: registration.videoStoragePath,
              path: registration.videoStoragePath,
              fileName,
              mimeType: registration.mimeType,
              sizeBytes: registration.sizeBytes,
              durationMs: registration.durationMs,
              thumbnailUrl: registration.posterStoragePath,
              thumbnailPath: registration.posterStoragePath,
              status: registration.status,
              createdAt: registration.createdAt,
              updatedAt: null,
            },
          });
          observer.complete();

          this.privacyDebug.log('media', 'VideoUploadFlow: upload concluído', {
            hasOwnerUid: true,
            hasVideoId: true,
            hasPoster: !!posterBinary,
            playbackReady: registration.status === 'ready',
            mimeType: registration.mimeType,
            sizeBytes: registration.sizeBytes,
          });
        } catch (error) {
          activeTask = null;

          /**
           * Antes da callable, o cliente ainda é responsável pelo rollback.
           * Depois que o registro backend começa, a Function assume a limpeza e a
           * idempotência. Isso evita apagar um arquivo já registrado quando a rede
           * perde apenas a resposta da callable.
           */
          if (!completed && !registrationStarted) {
            await scheduleCleanup();
          }

          if (cancelRequested || error instanceof VideoUploadCancelledError) {
            return;
          }

          this.reportError(error, {
            op: 'uploadPrivateVideo$',
            hasOwnerUid: !!ownerUid,
            hasVideoId: !!videoId,
            mimeType: file.type,
            sizeBytes: file.size,
            registrationStarted,
          });
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
        void scheduleCleanup();
      };
    });
  }

  private registerUploadedVideo(
    payload: RegisterPrivateVideoUploadRequest
  ): Promise<RegisterPrivateVideoUploadResponse> {
    const callable = httpsCallable<
      RegisterPrivateVideoUploadRequest,
      RegisterPrivateVideoUploadResponse
    >(this.functions, 'registerPrivateVideoUpload');

    return callable(payload).then((response) => response.data);
  }

  private uploadBinary(
    storagePath: string,
    data: Blob,
    contentType: string,
    registerTask: (task: UploadTask) => void,
    onProgress: (progress: number) => void
  ): Promise<UploadedBinary> {
    return new Promise<UploadedBinary>((resolve, reject) => {
      const storageRef = ref(this.storage, storagePath);
      const task = uploadBytesResumable(storageRef, data, {
        contentType,
        cacheControl: 'private, max-age=0, no-store, no-transform',
      });

      registerTask(task);

      task.on(
        'state_changed',
        (snapshot) => {
          const progress = snapshot.totalBytes > 0
            ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            : 0;
          onProgress(this.normalizeProgress(progress));
        },
        reject,
        () => resolve({ path: storagePath })
      );
    });
  }

  private deleteBinaryBestEffort(
    storagePath: string,
    assetKind: 'video' | 'poster'
  ): Promise<void> {
    return deleteObject(ref(this.storage, storagePath)).catch((error) => {
      if (this.isObjectNotFoundError(error)) {
        return;
      }

      this.reportCleanupError(error, assetKind);
    });
  }

  private isObjectNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }

    return String((error as { code?: unknown }).code ?? '') ===
      'storage/object-not-found';
  }

  private requireOwnedUid(ownerUid: string): string {
    const safeOwnerUid = String(ownerUid ?? '').trim();
    const authenticatedUid = this.auth.currentUser?.uid?.trim() ?? '';

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(safeOwnerUid)) {
      throw new Error('Perfil inválido para upload de vídeo.');
    }

    if (!authenticatedUid || authenticatedUid !== safeOwnerUid) {
      throw new Error('O upload deve ocorrer no perfil autenticado.');
    }

    return safeOwnerUid;
  }

  private validateFile(file: File): File {
    if (!file) {
      throw new Error('Selecione um vídeo antes de enviar.');
    }

    const mimeType = String(file.type ?? '').toLowerCase();

    if (!ALLOWED_VIDEO_TYPES.has(mimeType)) {
      throw new Error('Envie um vídeo MP4, WebM ou MOV.');
    }

    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw new Error('O arquivo de vídeo está vazio ou inválido.');
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      throw new Error('O vídeo excede o limite de 500 MB.');
    }

    return file;
  }

  private buildVideoPath(ownerUid: string, videoId: string, file: File): string {
    const extension = this.resolveVideoExtension(file);

    return (
      `users/${ownerUid}/uploads/videos/` +
      `${videoId}-${this.randomId()}.${extension}`
    );
  }

  private buildPosterPath(ownerUid: string, videoId: string): string {
    return (
      `users/${ownerUid}/uploads/video-posters/${videoId}/` +
      `poster-${this.randomId()}.jpg`
    );
  }

  private resolveVideoExtension(file: File): string {
    const mimeType = String(file.type ?? '').toLowerCase();

    if (mimeType === 'video/webm') {
      return 'webm';
    }

    if (mimeType === 'video/quicktime') {
      return 'mov';
    }

    return 'mp4';
  }

  private normalizeDisplayFileName(value: string): string {
    const raw = String(value ?? '');
    let withoutControlCharacters = '';

    for (let index = 0; index < raw.length; index += 1) {
      const characterCode = raw.charCodeAt(index);

      if (characterCode > 31 && characterCode !== 127) {
        withoutControlCharacters += raw[index];
      }
    }

    const safeName = withoutControlCharacters.trim().slice(0, 160);
    return safeName || 'Vídeo';
  }

  private randomId(): string {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private mapProgress(progress: number, start: number, end: number): number {
    const normalized = this.normalizeProgress(progress) / 100;
    return Math.round(start + (end - start) * normalized);
  }

  private normalizeProgress(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private reportCleanupError(
    error: unknown,
    assetKind: 'video' | 'poster'
  ): void {
    this.reportError(error, {
      op: 'rollbackUploadedBinary',
      assetKind,
    });
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha no fluxo de upload de vídeo.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'VideoUploadFlowService',
        ...context,
      };
      (normalized as any).skipUserNotification = true;

      this.errorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
