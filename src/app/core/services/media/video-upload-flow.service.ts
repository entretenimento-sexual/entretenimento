import {
  Injectable,
  Injector,
  inject,
  runInInjectionContext,
} from '@angular/core';
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
import { Observable, Subject, Subscription, firstValueFrom, takeUntil } from 'rxjs';

import {
  DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
  IVideoEditRecipeInput,
} from 'src/app/core/interfaces/media/i-video-edit-recipe';
import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { IVideoPublicationSettingsInput } from 'src/app/core/interfaces/media/i-video-publication-config';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import { mapMediaUploadProgress, normalizeMediaUploadProgress } from './media-upload-progress.policy';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import {
  MEDIA_VIDEO_POSTER_MAX_BYTES,
  validateVideoMediaFile,
} from './media-format.policy';
import { VideoMetadataPreparationService } from './video-metadata-preparation.service';
import {
  VideoUploadFormat,
  resolveVideoUploadFormat,
} from './video-upload-format.policy';

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
  posterBlob?: Blob | null;
  editRecipe?: IVideoEditRecipeInput | null;
  publication: IVideoPublicationSettingsInput;
}

interface UploadedBinary {
  path: string;
}

interface ReserveVideoUploadRequest {
  ownerUid: string;
  videoId: string;
  videoStoragePath: string;
  videoSizeBytes: number;
  videoContentType: string;
  posterStoragePath: string | null;
  posterSizeBytes: number;
  posterContentType: string | null;
}

interface ReserveVideoUploadResponse {
  reservationId: string;
  expiresAt: number;
}

interface RegisterPrivateVideoUploadRequest
  extends IVideoPublicationSettingsInput {
  reservationId: string;
  ownerUid: string;
  videoId: string;
  videoStoragePath: string;
  posterStoragePath: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  editRecipe: IVideoEditRecipeInput;
  publishWhenReady: true;
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

const REGISTER_RETRY_DELAY_MS = 650;

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
  private readonly injector = inject(Injector);
  private readonly metadataPreparation = inject(VideoMetadataPreparationService);
  private readonly authSession = inject(AuthSessionService);
  private readonly errorHandler = inject(MediaApplicationErrorService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly reserveVideoUploadCallable = httpsCallable<
    ReserveVideoUploadRequest,
    ReserveVideoUploadResponse
  >(this.functions, 'reserveVideoUpload');
  private readonly registerPrivateVideoUploadCallable = httpsCallable<
    RegisterPrivateVideoUploadRequest,
    RegisterPrivateVideoUploadResponse
  >(this.functions, 'registerPrivateVideoUpload');

  uploadPrivateVideo$(
    command: IVideoUploadCommand
  ): Observable<IVideoUploadFlowEvent> {
    return new Observable<IVideoUploadFlowEvent>((observer) => {
      let ownerUid = '';
      let file: File;
      let sourceFormat: VideoUploadFormat;
      let selectedPosterBlob: Blob | null = null;

      try {
        ownerUid = this.requireOwnedUid(command.ownerUid);
        file = command.file;
        sourceFormat = this.validateFile(file);
        selectedPosterBlob = this.validateOptionalPoster(command.posterBlob);
      } catch (error) {
        this.reportError(error, {
          op: 'uploadPrivateVideo$.validate',
          hasOwnerUid: !!String(command.ownerUid ?? '').trim(),
          hasFile: !!command.file,
          hasSelectedPoster: !!command.posterBlob,
        });
        observer.error(error);
        return undefined;
      }

      let videoId = '';
      let videoPath = '';
      let posterPath: string | null = null;
      let activeTask: UploadTask | null = null;
      let cancelRequested = false;
      let registrationStarted = false;
      let completed = false;
      let cleanupChain = Promise.resolve();
      let videoUploadStarted = false;
      let posterUploadStarted = false;
      let authBoundarySubscription: Subscription | null = null;
      const cancelled$ = new Subject<void>();
      const cancelPendingPreparation = (): void => {
        cancelled$.next();
      };

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

      authBoundarySubscription = this.authSession.uid$.subscribe((uid) => {
        const activeUid = String(uid ?? '').trim();

        if (activeUid === ownerUid) {
          return;
        }

        cancelRequested = true;
        cancelPendingPreparation();
        activeTask?.cancel();

        if (!registrationStarted) {
          void scheduleCleanup();
        }

        observer.complete();
      });

      const run = async (): Promise<void> => {
        try {
          assertNotCancelled();
          observer.next({ type: 'progress', phase: 'preparing', progress: 2 });

          const editRecipe =
            command.editRecipe ?? DEFAULT_VIDEO_EDIT_RECIPE_INPUT;
          const metadata = await firstValueFrom(
            this.metadataPreparation.prepare$(file, {
              aspectRatio: editRecipe.aspectRatio,
              preferredTimeMs: editRecipe.trimStartMs,
            }).pipe(takeUntil(cancelled$))
          );
          const posterBlob = selectedPosterBlob ?? metadata.posterBlob;
          assertNotCancelled();

          const videoRef = runInInjectionContext(this.injector, () =>
            doc(collection(this.firestore, `users/${ownerUid}/videos`))
          );
          videoId = videoRef.id;
          videoPath = this.buildVideoPath(ownerUid, videoId, sourceFormat);
          posterPath = posterBlob
            ? this.buildPosterPath(ownerUid, videoId)
            : null;

          const reservation = await this.reserveVideoUpload({
            ownerUid,
            videoId,
            videoStoragePath: videoPath,
            videoSizeBytes: file.size,
            videoContentType: sourceFormat.mimeType,
            posterStoragePath: posterPath,
            posterSizeBytes: posterBlob?.size ?? 0,
            posterContentType: posterBlob ? 'image/jpeg' : null,
          });
          assertNotCancelled();

          observer.next({ type: 'progress', phase: 'preparing', progress: 6 });
          videoUploadStarted = true;

          const videoBinary = await this.uploadBinary(
            videoPath,
            file,
            sourceFormat.mimeType,
            reservation.reservationId,
            (task) => {
              activeTask = task;
            },
            (progress) => {
              observer.next({
                type: 'progress',
                phase: 'uploading-video',
                progress: mapMediaUploadProgress(progress, 6, 86),
              });
            }
          );
          activeTask = null;
          assertNotCancelled();

          let posterBinary: UploadedBinary | null = null;

          if (posterBlob && posterPath) {
            posterUploadStarted = true;
            posterBinary = await this.uploadBinary(
              posterPath,
              posterBlob,
              'image/jpeg',
              reservation.reservationId,
              (task) => {
                activeTask = task;
              },
              (progress) => {
                observer.next({
                  type: 'progress',
                  phase: 'uploading-poster',
                  progress: mapMediaUploadProgress(progress, 86, 96),
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
          const publication = this.normalizePublication(command.publication);
          const registration = await this.registerUploadedVideo({
            reservationId: reservation.reservationId,
            ownerUid,
            videoId,
            videoStoragePath: videoBinary.path,
            posterStoragePath: posterBinary?.path ?? null,
            fileName,
            mimeType: sourceFormat.mimeType,
            sizeBytes: file.size,
            durationMs: metadata.durationMs,
            editRecipe,
            publishWhenReady: true,
            ...publication,
          }, assertNotCancelled);
          assertNotCancelled();

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
              sourceMimeType: registration.mimeType,
              sourceSizeBytes: registration.sizeBytes,
              durationMs: registration.durationMs,
              thumbnailUrl: registration.posterStoragePath,
              thumbnailPath: registration.posterStoragePath,
              processingStage: 'queued',
              status: 'queued',
              createdAt: registration.createdAt,
              updatedAt: null,
            },
          });
          observer.complete();

          this.privacyDebug.log('media', 'VideoUploadFlow: upload concluído', {
            hasOwnerUid: true,
            hasVideoId: true,
            hasPoster: !!posterBinary,
            processingQueued: true,
            publicationRequested: true,
            mimeType: registration.mimeType,
            sourceExtension: sourceFormat.extension,
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
            mimeType: sourceFormat.mimeType,
            sourceExtension: sourceFormat.extension,
            sizeBytes: file.size,
            registrationStarted,
          });
          observer.error(error);
        }
      };

      void run();

      return () => {
        authBoundarySubscription?.unsubscribe();
        authBoundarySubscription = null;

        if (completed || registrationStarted) {
          return;
        }

        cancelRequested = true;
        cancelPendingPreparation();
        activeTask?.cancel();
        void scheduleCleanup();
      };
    });
  }

  private async reserveVideoUpload(
    payload: ReserveVideoUploadRequest
  ): Promise<ReserveVideoUploadResponse> {
    const response = await this.reserveVideoUploadCallable(payload);
    return response.data;
  }

  private async registerUploadedVideo(
    payload: RegisterPrivateVideoUploadRequest,
    assertActive: () => void
  ): Promise<RegisterPrivateVideoUploadResponse> {
    try {
      assertActive();
      const response = await this.registerPrivateVideoUploadCallable(payload);
      return response.data;
    } catch (error) {
      if (!this.isRetryableRegistrationError(error)) {
        throw error;
      }

      await this.delay(REGISTER_RETRY_DELAY_MS);
      // Não repita registro de A sob credenciais de B após logout/troca.
      assertActive();
      const retryResponse = await this.registerPrivateVideoUploadCallable(payload);
      return retryResponse.data;
    }
  }

  private isRetryableRegistrationError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }

    const code = String((error as { code?: unknown }).code ?? '')
      .replace(/^functions\//, '');

    return [
      'deadline-exceeded',
      'internal',
      'resource-exhausted',
      'unavailable',
      'unknown',
    ].includes(code);
  }

  private delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private uploadBinary(
    storagePath: string,
    data: Blob,
    contentType: string,
    reservationId: string,
    registerTask: (task: UploadTask) => void,
    onProgress: (progress: number) => void
  ): Promise<UploadedBinary> {
    return new Promise<UploadedBinary>((resolve, reject) => {
      const storageRef = ref(this.storage, storagePath);
      const task = uploadBytesResumable(storageRef, data, {
        contentType,
        cacheControl: 'private, max-age=0, no-store, no-transform',
        customMetadata: {
          mediaVideoReservationId: reservationId,
        },
      });

      registerTask(task);

      task.on(
        'state_changed',
        (snapshot) => {
          const progress = snapshot.totalBytes > 0
            ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            : 0;
          onProgress(normalizeMediaUploadProgress(progress));
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

  private validateFile(file: File): VideoUploadFormat {
    const validation = validateVideoMediaFile(file);
    if (!validation.valid) {
      throw new Error(
        validation.userMessage ?? 'O arquivo de vídeo não atende à política canônica.'
      );
    }

    const format = resolveVideoUploadFormat(file);
    if (!format) {
      throw new Error('O formato do vídeo não pôde ser resolvido pela política canônica.');
    }

    return format;
  }

  private validateOptionalPoster(value: Blob | null | undefined): Blob | null {
    if (!value) {
      return null;
    }

    if (value.type !== 'image/jpeg') {
      throw new Error('A capa escolhida precisa ser gerada em JPEG.');
    }

    if (!Number.isFinite(value.size) || value.size <= 0) {
      throw new Error('A capa escolhida está vazia.');
    }

    if (value.size > MEDIA_VIDEO_POSTER_MAX_BYTES) {
      const maxMegabytes = Number(
        (MEDIA_VIDEO_POSTER_MAX_BYTES / (1024 * 1024)).toFixed(1)
      );
      throw new Error(
        `A capa escolhida excede o limite de ${maxMegabytes} MB.`
      );
    }

    return value;
  }

  private normalizePublication(
    publication: IVideoUploadCommand['publication']
  ): IVideoPublicationSettingsInput {
    const title = String(publication?.title ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    const description = String(publication?.description ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);

    return {
      title: title || null,
      description: description || null,
      reactionsEnabled: publication?.reactionsEnabled !== false,
      commentsEnabled: publication?.commentsEnabled !== false,
      ratingsEnabled: publication?.ratingsEnabled !== false,
    };
  }

  private buildVideoPath(
    ownerUid: string,
    videoId: string,
    format: VideoUploadFormat
  ): string {
    return (
      `users/${ownerUid}/uploads/videos/` +
      `${videoId}-${this.randomId()}.${format.extension}`
    );
  }

  private buildPosterPath(ownerUid: string, videoId: string): string {
    return (
      `users/${ownerUid}/uploads/video-posters/${videoId}/` +
      `poster-${this.randomId()}.jpg`
    );
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
    this.errorHandler.reportSilently(
      error,
      String(context['op'] ?? 'videoUpload'),
      undefined,
      {
        scope: 'VideoUploadFlowService',
        ...context,
      },
      'video_upload_failed'
    );
  }

}
