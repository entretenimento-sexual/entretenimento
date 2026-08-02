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
import { Observable, firstValueFrom } from 'rxjs';

import { IVideoEditRecipeInput } from 'src/app/core/interfaces/media/i-video-edit-recipe';
import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { IVideoPublicationSettingsInput } from 'src/app/core/interfaces/media/i-video-publication-config';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { PrivateMediaDraftCapacityService } from './private-media-draft-capacity.service';
import {
  IPreparedVideoMetadata,
  VideoMetadataPreparationService,
} from './video-metadata-preparation.service';
import {
  VideoUploadFormat,
  VIDEO_UPLOAD_FORMAT_LABEL,
  resolveVideoUploadFormat,
} from './video-upload-format.policy';
import {
  IVideoUploadFlowEvent,
  VideoUploadProgressPhase,
} from './video-upload-flow.service';

export interface IEditedVideoUploadCommand {
  ownerUid: string;
  file: File;
  posterBlob?: Blob | null;
  publication: IVideoPublicationSettingsInput & {
    publishWhenReady: boolean;
  };
  editRecipe: IVideoEditRecipeInput;
}

interface RegisterEditedVideoRequest
  extends IVideoPublicationSettingsInput {
  ownerUid: string;
  videoId: string;
  videoStoragePath: string;
  posterStoragePath: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  publishWhenReady: boolean;
  editRecipe: IVideoEditRecipeInput;
}

interface RegisterEditedVideoResponse {
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

interface UploadedBinary {
  path: string;
}

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_POSTER_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_EDITED_DURATION_MS = 5_000;
const REGISTER_RETRY_DELAY_MS = 650;

class EditedVideoUploadCancelledError extends Error {
  readonly code = 'media/edited-video-upload-cancelled';

  constructor() {
    super('Upload de vídeo cancelado.');
  }
}

@Injectable({ providedIn: 'root' })
export class VideoEditedUploadFlowService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly storage = inject(Storage);
  private readonly injector = inject(Injector);
  private readonly metadataPreparation = inject(VideoMetadataPreparationService);
  private readonly draftCapacity = inject(PrivateMediaDraftCapacityService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly registerCallable = httpsCallable<
    RegisterEditedVideoRequest,
    RegisterEditedVideoResponse
  >(this.functions, 'registerPrivateVideoUpload');

  uploadEditedVideo$(
    command: IEditedVideoUploadCommand
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
          op: 'uploadEditedVideo$.validate',
          hasOwnerUid: !!String(command.ownerUid ?? '').trim(),
          hasFile: !!command.file,
        });
        observer.error(error);
        return undefined;
      }

      const videoRef = runInInjectionContext(this.injector, () =>
        doc(collection(this.firestore, `users/${ownerUid}/videos`))
      );
      const videoId = videoRef.id;
      const videoPath = this.buildVideoPath(ownerUid, videoId, sourceFormat);
      let posterPath: string | null = null;
      let activeTask: UploadTask | null = null;
      let cancelRequested = false;
      let registrationStarted = false;
      let completed = false;
      let videoUploadStarted = false;
      let posterUploadStarted = false;
      let cleanupChain = Promise.resolve();

      const scheduleCleanup = (): Promise<void> => {
        cleanupChain = cleanupChain.then(async () => {
          const tasks: Promise<void>[] = [];

          if (posterUploadStarted && posterPath) {
            tasks.push(this.deleteBinaryBestEffort(posterPath, 'poster'));
            posterUploadStarted = false;
          }

          if (videoUploadStarted) {
            tasks.push(this.deleteBinaryBestEffort(videoPath, 'video'));
            videoUploadStarted = false;
          }

          await Promise.all(tasks);
        });

        return cleanupChain;
      };

      const assertNotCancelled = (): void => {
        if (cancelRequested) {
          throw new EditedVideoUploadCancelledError();
        }
      };

      const emitProgress = (
        phase: VideoUploadProgressPhase,
        progress: number
      ): void => {
        observer.next({ type: 'progress', phase, progress });
      };

      const run = async (): Promise<void> => {
        try {
          emitProgress('preparing', 2);
          const requestedRecipe = command.editRecipe;
          const metadata = await firstValueFrom(
            this.metadataPreparation.prepare$(file, {
              aspectRatio: requestedRecipe.aspectRatio,
              preferredTimeMs: requestedRecipe.trimStartMs,
            })
          );
          const editRecipe = this.normalizeEditRecipe(
            requestedRecipe,
            metadata
          );
          const posterBlob = selectedPosterBlob ?? metadata.posterBlob;
          assertNotCancelled();

          emitProgress('preparing', 4);
          await firstValueFrom(
            this.draftCapacity.assertCapacity$(
              'video',
              file.size,
              posterBlob?.size ?? 0
            )
          );
          assertNotCancelled();

          emitProgress('preparing', 6);
          videoUploadStarted = true;
          const videoBinary = await this.uploadBinary(
            videoPath,
            file,
            sourceFormat.mimeType,
            (task) => {
              activeTask = task;
            },
            (progress) => {
              emitProgress(
                'uploading-video',
                this.mapProgress(progress, 6, 86)
              );
            }
          );
          activeTask = null;
          assertNotCancelled();

          let posterBinary: UploadedBinary | null = null;

          if (posterBlob) {
            posterPath = this.buildPosterPath(ownerUid, videoId);
            posterUploadStarted = true;
            posterBinary = await this.uploadBinary(
              posterPath,
              posterBlob,
              'image/jpeg',
              (task) => {
                activeTask = task;
              },
              (progress) => {
                emitProgress(
                  'uploading-poster',
                  this.mapProgress(progress, 86, 96)
                );
              }
            );
            activeTask = null;
            assertNotCancelled();
          }

          emitProgress('saving', 98);
          registrationStarted = true;
          const publication = this.normalizePublication(command.publication);
          const fileName = this.normalizeDisplayFileName(file.name);
          const registration = await this.registerUploadedVideo({
            ownerUid,
            videoId,
            videoStoragePath: videoBinary.path,
            posterStoragePath: posterBinary?.path ?? null,
            fileName,
            mimeType: sourceFormat.mimeType,
            sizeBytes: file.size,
            durationMs: metadata.durationMs,
            editRecipe,
            ...publication,
          });

          completed = true;
          emitProgress('saving', 100);
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
            } as IVideoItem,
          });
          observer.complete();

          this.privacyDebug.log('media', 'VideoEditedUpload: upload concluído', {
            hasOwnerUid: true,
            hasVideoId: true,
            hasPoster: !!posterBinary,
            aspectRatio: editRecipe.aspectRatio,
            muted: editRecipe.muteAudio,
            trimmed: editRecipe.trimStartMs > 0 || editRecipe.trimEndMs !== null,
            sizeBytes: registration.sizeBytes,
          });
        } catch (error) {
          activeTask = null;

          if (!completed && !registrationStarted) {
            await scheduleCleanup();
          }

          if (
            cancelRequested ||
            error instanceof EditedVideoUploadCancelledError
          ) {
            return;
          }

          this.reportError(error, {
            op: 'uploadEditedVideo$',
            hasOwnerUid: !!ownerUid,
            hasVideoId: !!videoId,
            mimeType: sourceFormat.mimeType,
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

  private normalizeEditRecipe(
    requested: IVideoEditRecipeInput,
    metadata: IPreparedVideoMetadata
  ): IVideoEditRecipeInput {
    const durationMs = metadata.durationMs;
    const start = Math.max(0, Math.trunc(Number(requested.trimStartMs ?? 0)));
    const requestedEnd = requested.trimEndMs === null
      ? null
      : Math.trunc(Number(requested.trimEndMs));

    if (durationMs === null && (start > 0 || requestedEnd !== null)) {
      throw new Error(
        'Este navegador não conseguiu ler a duração para aplicar o corte.'
      );
    }

    if (durationMs !== null) {
      const end = requestedEnd ?? durationMs;

      if (start >= durationMs || end > durationMs || end <= start) {
        throw new Error('Revise o início e o fim do corte.');
      }

      if (end - start < MIN_EDITED_DURATION_MS) {
        throw new Error('O vídeo editado precisa ter pelo menos 5 segundos.');
      }
    }

    const aspectRatio = requested.aspectRatio;
    const width = metadata.widthPixels;
    const height = metadata.heightPixels;

    if (aspectRatio !== 'ORIGINAL' && (!width || !height)) {
      throw new Error(
        'Este navegador não conseguiu ler as dimensões para alterar o enquadramento.'
      );
    }

    return {
      version: 1,
      trimStartMs: start,
      trimEndMs:
        durationMs !== null && requestedEnd !== null && requestedEnd < durationMs
          ? requestedEnd
          : null,
      aspectRatio,
      muteAudio: requested.muteAudio === true,
      orientation: 'AUTO',
      sourceWidthPixels: width,
      sourceHeightPixels: height,
    };
  }

  private async registerUploadedVideo(
    payload: RegisterEditedVideoRequest
  ): Promise<RegisterEditedVideoResponse> {
    try {
      const response = await this.registerCallable(payload);
      return response.data;
    } catch (error) {
      if (!this.isRetryableRegistrationError(error)) {
        throw error;
      }

      await this.delay(REGISTER_RETRY_DELAY_MS);
      const retry = await this.registerCallable(payload);
      return retry.data;
    }
  }

  private uploadBinary(
    storagePath: string,
    data: Blob,
    contentType: string,
    registerTask: (task: UploadTask) => void,
    onProgress: (progress: number) => void
  ): Promise<UploadedBinary> {
    return new Promise<UploadedBinary>((resolve, reject) => {
      const task = uploadBytesResumable(ref(this.storage, storagePath), data, {
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

      this.reportError(error, {
        op: 'rollbackEditedVideoBinary',
        assetKind,
      });
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

  private validateFile(file: File): VideoUploadFormat {
    const format = resolveVideoUploadFormat(file);

    if (!format) {
      throw new Error(
        `Envie um vídeo em um destes formatos: ${VIDEO_UPLOAD_FORMAT_LABEL}.`
      );
    }

    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw new Error('O arquivo de vídeo está vazio ou inválido.');
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      throw new Error('O vídeo excede o limite de 500 MB.');
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

    if (value.size > MAX_POSTER_SIZE_BYTES) {
      throw new Error('A capa escolhida excede o limite de 10 MB.');
    }

    return value;
  }

  private normalizePublication(
    publication: IEditedVideoUploadCommand['publication']
  ): IVideoPublicationSettingsInput & { publishWhenReady: boolean } {
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
      publishWhenReady: publication?.publishWhenReady === true,
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
    let sanitized = '';

    for (let index = 0; index < raw.length; index += 1) {
      const code = raw.charCodeAt(index);
      if (code > 31 && code !== 127) sanitized += raw[index];
    }

    return sanitized.trim().slice(0, 160) || 'Vídeo';
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

  private isObjectNotFoundError(error: unknown): boolean {
    return typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      String((error as { code?: unknown }).code ?? '') ===
        'storage/object-not-found';
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

  private delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha no fluxo de edição e upload do vídeo.');

      if (normalized !== error) {
        (normalized as any).original = error;
      }
      (normalized as any).context = {
        scope: 'VideoEditedUploadFlowService',
        ...context,
      };
      (normalized as any).skipUserNotification = true;
      this.errorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
