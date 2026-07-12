import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import {
  deleteObject,
  getDownloadURL,
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
  url: string;
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
      let commitStarted = false;
      let completed = false;
      let cleanupChain = Promise.resolve();
      let videoUploaded = false;
      let posterUploaded = false;

      const scheduleCleanup = (): Promise<void> => {
        cleanupChain = cleanupChain.then(async () => {
          const cleanupTasks: Promise<unknown>[] = [];

          if (posterUploaded && posterPath) {
            cleanupTasks.push(
              deleteObject(ref(this.storage, posterPath)).catch((error) => {
                this.reportCleanupError(error, 'poster');
              })
            );
            posterUploaded = false;
          }

          if (videoUploaded) {
            cleanupTasks.push(
              deleteObject(ref(this.storage, videoPath)).catch((error) => {
                this.reportCleanupError(error, 'video');
              })
            );
            videoUploaded = false;
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
          videoUploaded = true;
          assertNotCancelled();

          let posterBinary: UploadedBinary | null = null;

          if (metadata.posterBlob && metadata.posterMimeType) {
            posterPath = this.buildPosterPath(ownerUid, videoId);
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
            posterUploaded = true;
            assertNotCancelled();
          }

          observer.next({ type: 'progress', phase: 'saving', progress: 98 });
          assertNotCancelled();
          commitStarted = true;

          const createdAt = Date.now();
          const status = metadata.playbackReady ? 'ready' : 'uploaded';
          const fileName = this.normalizeDisplayFileName(file.name);

          await setDoc(videoRef, {
            id: videoId,
            ownerUid,
            url: videoBinary.url,
            path: videoBinary.path,
            fileName,
            mimeType: file.type,
            sizeBytes: file.size,
            durationMs: metadata.durationMs,
            thumbnailUrl: posterBinary?.url ?? null,
            thumbnailPath: posterBinary?.path ?? null,
            status,
            createdAt: serverTimestamp(),
            updatedAt: null,
          });

          completed = true;
          observer.next({ type: 'progress', phase: 'saving', progress: 100 });
          observer.next({
            type: 'success',
            result: {
              id: videoId,
              ownerUid,
              url: videoBinary.url,
              path: videoBinary.path,
              fileName,
              mimeType: file.type,
              sizeBytes: file.size,
              durationMs: metadata.durationMs,
              thumbnailUrl: posterBinary?.url ?? null,
              thumbnailPath: posterBinary?.path ?? null,
              status,
              createdAt,
              updatedAt: null,
            },
          });
          observer.complete();

          this.privacyDebug.log('media', 'VideoUploadFlow: upload concluído', {
            hasOwnerUid: true,
            hasVideoId: true,
            hasPoster: !!posterBinary,
            playbackReady: metadata.playbackReady,
            mimeType: file.type,
            sizeBytes: file.size,
          });
        } catch (error) {
          activeTask = null;

          if (!completed) {
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
            commitStarted,
          });
          observer.error(error);
        }
      };

      void run();

      return () => {
        if (completed || commitStarted) {
          return;
        }

        cancelRequested = true;
        activeTask?.cancel();
        void scheduleCleanup();
      };
    });
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
        () => {
          getDownloadURL(task.snapshot.ref)
            .then((url) => resolve({ path: storagePath, url }))
            .catch(reject);
        }
      );
    });
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
