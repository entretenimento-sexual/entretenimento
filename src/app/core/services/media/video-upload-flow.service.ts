import {
  Injectable,
  Injector,
  inject,
  runInInjectionContext,
} from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, doc } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import type { UploadTask } from 'firebase/storage';
import { Observable, firstValueFrom } from 'rxjs';

import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { IVideoPublicationSettingsInput } from 'src/app/core/interfaces/media/i-video-publication-config';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { PrivateMediaDraftCapacityService } from './private-media-draft-capacity.service';
import { PrivateMediaReservedUploadService } from './private-media-reserved-upload.service';
import { VideoMetadataPreparationService } from './video-metadata-preparation.service';
import {
  VideoUploadFormat,
  VIDEO_UPLOAD_FORMAT_LABEL,
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
  publication: IVideoPublicationSettingsInput & {
    publishWhenReady: boolean;
  };
}

interface RegisterPrivateVideoUploadRequest
  extends IVideoPublicationSettingsInput {
  ownerUid: string;
  videoId: string;
  reservationId: string;
  videoStoragePath: string;
  posterStoragePath: string | null;
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
  private readonly injector = inject(Injector);
  private readonly metadataPreparation = inject(VideoMetadataPreparationService);
  private readonly draftCapacity = inject(PrivateMediaDraftCapacityService);
  private readonly reservedUpload = inject(PrivateMediaReservedUploadService);
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

      const videoRef = runInInjectionContext(this.injector, () =>
        doc(collection(this.firestore, `users/${ownerUid}/videos`))
      );
      const videoId = videoRef.id;
      const videoPath = this.buildVideoPath(ownerUid, videoId, sourceFormat);
      let posterPath: string | null = null;
      let reservationId = '';
      let activeTask: UploadTask | null = null;
      let cancelRequested = false;
      let registrationStarted = false;
      let completed = false;
      let cleanupChain = Promise.resolve();

      const scheduleCleanup = (): Promise<void> => {
        cleanupChain = cleanupChain.then(async () => {
          if (!reservationId) {
            return;
          }

          const activeReservationId = reservationId;
          reservationId = '';
          await this.cancelReservationBestEffort(activeReservationId);
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
          posterPath = posterBlob
            ? this.buildPosterPath(ownerUid, videoId)
            : null;
          assertNotCancelled();

          observer.next({ type: 'progress', phase: 'preparing', progress: 4 });
          const reservation = await firstValueFrom(
            this.draftCapacity.reserveUpload$({
              ownerUid,
              mediaId: videoId,
              kind: 'video',
              operation: 'CREATE',
              sourceStoragePath: videoPath,
              auxiliaryStoragePath: posterPath,
              sourceSizeBytes: file.size,
              auxiliarySizeBytes: posterBlob?.size ?? 0,
            })
          );
          reservationId = reservation.reservationId;
          assertNotCancelled();

          observer.next({ type: 'progress', phase: 'preparing', progress: 6 });
          const videoBinary = await firstValueFrom(
            this.reservedUpload.upload$(
              videoPath,
              file,
              sourceFormat.mimeType,
              reservationId,
              (progress) => {
                observer.next({
                  type: 'progress',
                  phase: 'uploading-video',
                  progress: this.mapProgress(progress, 6, 86),
                });
              },
              (task) => {
                activeTask = task;
              }
            )
          );
          activeTask = null;
          assertNotCancelled();

          let uploadedPosterPath: string | null = null;

          if (posterBlob && posterPath) {
            const posterBinary = await firstValueFrom(
              this.reservedUpload.upload$(
                posterPath,
                posterBlob,
                'image/jpeg',
                reservationId,
                (progress) => {
                  observer.next({
                    type: 'progress',
                    phase: 'uploading-poster',
                    progress: this.mapProgress(progress, 86, 96),
                  });
                },
                (task) => {
                  activeTask = task;
                }
              )
            );
            uploadedPosterPath = posterBinary.storagePath;
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
            reservationId,
            videoStoragePath: videoBinary.storagePath,
            posterStoragePath: uploadedPosterPath,
            fileName,
            mimeType: sourceFormat.mimeType,
            sizeBytes: file.size,
            durationMs: metadata.durationMs,
            ...publication,
          });

          completed = true;
          reservationId = '';
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
            hasPoster: !!uploadedPosterPath,
            processingQueued: true,
            publishWhenReady: publication.publishWhenReady,
            mimeType: registration.mimeType,
            sourceExtension: sourceFormat.extension,
            sizeBytes: registration.sizeBytes,
          });
        } catch (error) {
          activeTask = null;

          /**
           * Antes da callable de registro, o cliente cancela a reserva. A
           * Function libera a quota e remove todos os objetos reservados. Após
           * o início do registro, a própria Function assume a idempotência.
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
      'unavailable',
      'unknown',
    ].includes(code);
  }

  private delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private cancelReservationBestEffort(reservationId: string): Promise<void> {
    return firstValueFrom(
      this.draftCapacity.cancelUploadReservation$(reservationId)
    ).then(() => undefined).catch(() => undefined);
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

  private normalizePublication(
    publication: IVideoUploadCommand['publication']
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
      // A telemetria não pode substituir o erro original.
    }
  }
}
