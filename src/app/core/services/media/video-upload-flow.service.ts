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

import type { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import type { IVideoPublicationSettingsInput } from 'src/app/core/interfaces/media/i-video-publication-config';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { VideoMetadataPreparationService } from './video-metadata-preparation.service';
import {
  VideoUploadFormat,
  VIDEO_UPLOAD_FORMAT_LABEL,
  resolveVideoUploadFormat,
} from './video-upload-format.policy';
import type {
  IVideoUploadSafetyAttestationInput,
} from './video-upload-safety-attestation.policy';

export type VideoUploadProgressPhase =
  | 'preparing'
  | 'uploading-video'
  | 'uploading-poster'
  | 'uploading-caption'
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

export interface IVideoUploadCaptionInput {
  file: File;
  language: string;
  label: string;
}

export interface IVideoUploadCommand {
  ownerUid: string;
  file: File;
  posterBlob?: Blob | null;
  caption?: IVideoUploadCaptionInput | null;
  publication: IVideoPublicationSettingsInput & {
    publishWhenReady: boolean;
  };
  safetyAttestation: IVideoUploadSafetyAttestationInput;
}

interface UploadedBinary {
  path: string;
}

interface NormalizedCaptionInput {
  file: File;
  language: string;
  label: string;
}

interface RegisterPrivateVideoUploadRequest
  extends IVideoPublicationSettingsInput,
    IVideoUploadSafetyAttestationInput {
  ownerUid: string;
  videoId: string;
  videoStoragePath: string;
  posterStoragePath: string | null;
  captionStoragePath: string | null;
  captionLanguage: string | null;
  captionLabel: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  publishWhenReady: boolean;
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
const MAX_POSTER_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_CAPTION_SIZE_BYTES = 1024 * 1024;
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
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
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
      let caption: NormalizedCaptionInput | null = null;

      try {
        ownerUid = this.requireOwnedUid(command.ownerUid);
        file = command.file;
        sourceFormat = this.validateFile(file);
        selectedPosterBlob = this.validateOptionalPoster(command.posterBlob);
        caption = this.validateOptionalCaption(command.caption);
      } catch (error) {
        this.reportError(error, {
          op: 'uploadPrivateVideo$.validate',
          hasOwnerUid: !!String(command.ownerUid ?? '').trim(),
          hasFile: !!command.file,
          hasSelectedPoster: !!command.posterBlob,
          hasCaption: !!command.caption,
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
      let captionPath: string | null = null;
      let activeTask: UploadTask | null = null;
      let cancelRequested = false;
      let registrationStarted = false;
      let completed = false;
      let cleanupChain = Promise.resolve();
      let videoUploadStarted = false;
      let posterUploadStarted = false;
      let captionUploadStarted = false;

      const scheduleCleanup = (): Promise<void> => {
        cleanupChain = cleanupChain.then(async () => {
          const cleanupTasks: Promise<void>[] = [];

          if (captionUploadStarted && captionPath) {
            cleanupTasks.push(
              this.deleteBinaryBestEffort(captionPath, 'caption')
            );
            captionUploadStarted = false;
          }

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
          const posterBlob = selectedPosterBlob ?? metadata.posterBlob;
          assertNotCancelled();

          observer.next({ type: 'progress', phase: 'preparing', progress: 6 });
          videoUploadStarted = true;

          const videoBinary = await this.uploadBinary(
            videoPath,
            file,
            sourceFormat.mimeType,
            (task) => {
              activeTask = task;
            },
            (progress) => {
              observer.next({
                type: 'progress',
                phase: 'uploading-video',
                progress: this.mapProgress(progress, 6, 82),
              });
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
                observer.next({
                  type: 'progress',
                  phase: 'uploading-poster',
                  progress: this.mapProgress(progress, 82, 90),
                });
              }
            );
            activeTask = null;
            assertNotCancelled();
          }

          let captionBinary: UploadedBinary | null = null;

          if (caption) {
            captionPath = this.buildCaptionPath(ownerUid, videoId);
            captionUploadStarted = true;
            captionBinary = await this.uploadBinary(
              captionPath,
              caption.file,
              'text/vtt',
              (task) => {
                activeTask = task;
              },
              (progress) => {
                observer.next({
                  type: 'progress',
                  phase: 'uploading-caption',
                  progress: this.mapProgress(progress, 90, 96),
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
            ownerUid,
            videoId,
            videoStoragePath: videoBinary.path,
            posterStoragePath: posterBinary?.path ?? null,
            captionStoragePath: captionBinary?.path ?? null,
            captionLanguage: caption?.language ?? null,
            captionLabel: caption?.label ?? null,
            fileName,
            mimeType: sourceFormat.mimeType,
            sizeBytes: file.size,
            durationMs: metadata.durationMs,
            ...publication,
            ...command.safetyAttestation,
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
              sourceMimeType: registration.mimeType,
              sourceSizeBytes: registration.sizeBytes,
              durationMs: registration.durationMs,
              thumbnailUrl: registration.posterStoragePath,
              thumbnailPath: registration.posterStoragePath,
              captionTracks: captionBinary && caption
                ? [{
                    id: 'captions-1',
                    kind: 'captions',
                    language: caption.language,
                    label: caption.label,
                    storagePath: captionBinary.path,
                    isDefault: true,
                  }]
                : [],
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
            hasCaption: !!captionBinary,
            processingQueued: true,
            publishWhenReady: publication.publishWhenReady,
            safetyAttestationVersion:
              command.safetyAttestation.safetyAttestationVersion,
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
            hasCaption: !!caption,
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
        if (completed || registrationStarted) {
          return;
        }

        cancelRequested = true;
        activeTask?.cancel();
        void scheduleCleanup();
      };
    });
  }

  private async registerUploadedVideo(
    payload: RegisterPrivateVideoUploadRequest
  ): Promise<RegisterPrivateVideoUploadResponse> {
    try {
      const response = await this.registerPrivateVideoUploadCallable(payload);
      return response.data;
    } catch (error) {
      if (!this.isRetryableRegistrationError(error)) {
        throw error;
      }

      await this.delay(REGISTER_RETRY_DELAY_MS);
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
    assetKind: 'video' | 'poster' | 'caption'
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
    if (!file) {
      throw new Error('Selecione um vídeo antes de enviar.');
    }

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

  private validateOptionalCaption(
    value: IVideoUploadCaptionInput | null | undefined
  ): NormalizedCaptionInput | null {
    if (!value) {
      return null;
    }

    const file = value.file;
    const fileName = String(file?.name ?? '').trim();

    if (!file || !fileName.toLowerCase().endsWith('.vtt')) {
      throw new Error('Selecione uma legenda no formato WebVTT (.vtt).');
    }

    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw new Error('O arquivo de legenda está vazio.');
    }

    if (file.size > MAX_CAPTION_SIZE_BYTES) {
      throw new Error('A legenda excede o limite de 1 MB.');
    }

    const language = String(value.language ?? '').trim();

    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) {
      throw new Error('Informe um idioma válido para a legenda.');
    }

    const label = String(value.label ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);

    if (!label) {
      throw new Error('Informe um rótulo para a legenda.');
    }

    return {
      file: file.type === 'text/vtt'
        ? file
        : new File([file], file.name, {
            type: 'text/vtt',
            lastModified: file.lastModified,
          }),
      language,
      label,
    };
  }

  private normalizePublication(
    publication: IVideoUploadCommand['publication']
  ): RegisterPrivateVideoUploadRequest extends infer _Unused
    ? IVideoPublicationSettingsInput & { publishWhenReady: boolean }
    : never {
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
      publishWhenReady: true,
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

  private buildCaptionPath(ownerUid: string, videoId: string): string {
    return (
      `users/${ownerUid}/uploads/video-captions/${videoId}/` +
      `captions-${this.randomId()}.vtt`
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
    assetKind: 'video' | 'poster' | 'caption'
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

      if (normalized !== error) {
        (normalized as any).original = error;
      }
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
