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
  ref,
  type UploadTask,
  uploadBytesResumable,
} from 'firebase/storage';
import { Observable, firstValueFrom } from 'rxjs';

import {
  DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
  IVideoEditRecipeInput,
  TVideoEditAspectRatio,
} from 'src/app/core/interfaces/media/i-video-edit-recipe';
import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { IVideoPublicationSettingsInput } from 'src/app/core/interfaces/media/i-video-publication-config';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import {
  PrivateVideoUploadCapacity,
  PrivateVideoUploadReservation,
  PrivateVideoUploadReservationService,
} from './private-video-upload-reservation.service';
import {
  IPreparedVideoMetadata,
  VideoMetadataPreparationService,
} from './video-metadata-preparation.service';
import {
  VideoUploadFormat,
  VIDEO_UPLOAD_FORMAT_LABEL,
  resolveVideoUploadFormat,
} from './video-upload-format.policy';

export type VideoUploadProgressPhase =
  | 'preparing'
  | 'reserving'
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
  publication: IVideoPublicationSettingsInput & {
    publishWhenReady: boolean;
  };
}

interface UploadedBinary {
  path: string;
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
  editRecipe: IVideoEditRecipeInput;
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
  private readonly reservationService = inject(
    PrivateVideoUploadReservationService
  );
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
        sourceFormat = this.validateFileIdentity(file);
        selectedPosterBlob = command.posterBlob ?? null;
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
      const clientRequestId = this.randomId();
      const videoPath = this.buildVideoPath(ownerUid, videoId, sourceFormat);
      let posterPath: string | null = null;
      let reservation: PrivateVideoUploadReservation | null = null;
      let activeTask: UploadTask | null = null;
      let cancelRequested = false;
      let registrationStarted = false;
      let completed = false;
      let cancellationStarted = false;

      const cancelReservationBestEffort = async (): Promise<void> => {
        if (!reservation || cancellationStarted) {
          return;
        }

        cancellationStarted = true;

        try {
          await firstValueFrom(
            this.reservationService.cancelReservation$(
              reservation.reservationId
            )
          );
        } catch (error) {
          this.reportError(error, {
            op: 'cancelPrivateVideoUploadReservation',
            hasOwnerUid: true,
            hasVideoId: true,
            hasReservationId: true,
          });
        }
      };

      const assertNotCancelled = (): void => {
        if (cancelRequested) {
          throw new VideoUploadCancelledError();
        }
      };

      const run = async (): Promise<void> => {
        try {
          observer.next({ type: 'progress', phase: 'preparing', progress: 2 });

          const capacity = await firstValueFrom(
            this.reservationService.getCapacity$()
          );
          this.assertCapacityAllowsUpload(capacity);
          this.validateFileSize(file, capacity.maxSourceBytes);
          assertNotCancelled();

          const requestedRecipe = command.editRecipe ??
            DEFAULT_VIDEO_EDIT_RECIPE_INPUT;
          const metadata = await firstValueFrom(
            this.metadataPreparation.prepare$(file, {
              aspectRatio: requestedRecipe.aspectRatio,
              preferredTimeMs: requestedRecipe.trimStartMs,
            })
          );
          this.validateSourceDuration(metadata.durationMs, capacity);
          const editRecipe = this.normalizeEditRecipe(
            requestedRecipe,
            metadata,
            capacity
          );
          const posterBlob = this.validateOptionalPoster(
            selectedPosterBlob ?? metadata.posterBlob,
            capacity.maxPosterBytes
          );
          posterPath = posterBlob
            ? this.buildPosterPath(ownerUid, videoId)
            : null;
          assertNotCancelled();

          observer.next({ type: 'progress', phase: 'reserving', progress: 5 });
          reservation = await firstValueFrom(
            this.reservationService.reserveUpload$({
              clientRequestId,
              ownerUid,
              videoId,
              videoStoragePath: videoPath,
              posterStoragePath: posterPath,
              videoSizeBytes: file.size,
              posterSizeBytes: posterBlob?.size ?? 0,
              sourceDurationMs: metadata.durationMs ?? 0,
              mimeType: sourceFormat.mimeType,
            })
          );
          assertNotCancelled();

          observer.next({ type: 'progress', phase: 'preparing', progress: 7 });
          const videoBinary = await this.uploadBinary(
            videoPath,
            file,
            sourceFormat.mimeType,
            reservation.reservationId,
            videoId,
            (task) => {
              activeTask = task;
            },
            (progress) => {
              observer.next({
                type: 'progress',
                phase: 'uploading-video',
                progress: this.mapProgress(progress, 7, 86),
              });
            }
          );
          activeTask = null;
          assertNotCancelled();

          let posterBinary: UploadedBinary | null = null;

          if (posterBlob && posterPath) {
            posterBinary = await this.uploadBinary(
              posterPath,
              posterBlob,
              'image/jpeg',
              reservation.reservationId,
              videoId,
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
          const publication = this.normalizePublication(command.publication);
          const registration = await this.registerUploadedVideo({
            ownerUid,
            videoId,
            reservationId: reservation.reservationId,
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
            hasReservationId: true,
            hasPoster: !!posterBinary,
            processingQueued: true,
            publishWhenReady: publication.publishWhenReady,
            quotaPlan: reservation.plan,
            reservedBytes: reservation.reservedBytes,
            mimeType: registration.mimeType,
            sourceExtension: sourceFormat.extension,
            sizeBytes: registration.sizeBytes,
            durationMs: registration.durationMs,
            edited: this.hasEffectiveEdit(editRecipe, metadata.durationMs),
            aspectRatio: editRecipe.aspectRatio,
            muteAudio: editRecipe.muteAudio,
          });
        } catch (error) {
          activeTask = null;

          /**
           * Antes do registro, o cancelamento backend encerra a reserva e remove
           * qualquer objeto parcial. Depois que a callable começa, o backend e o
           * trigger idempotente assumem a confirmação e a limpeza.
           */
          if (!completed && !registrationStarted) {
            await cancelReservationBestEffort();
          }

          if (cancelRequested || error instanceof VideoUploadCancelledError) {
            return;
          }

          this.reportError(error, {
            op: 'uploadPrivateVideo$',
            hasOwnerUid: !!ownerUid,
            hasVideoId: !!videoId,
            hasReservationId: !!reservation?.reservationId,
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
        void cancelReservationBestEffort();
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
    reservationId: string,
    videoId: string,
    registerTask: (task: UploadTask) => void,
    onProgress: (progress: number) => void
  ): Promise<UploadedBinary> {
    return new Promise<UploadedBinary>((resolve, reject) => {
      const storageRef = ref(this.storage, storagePath);
      const task = uploadBytesResumable(storageRef, data, {
        contentType,
        cacheControl: 'private, max-age=0, no-store, no-transform',
        customMetadata: {
          videoReservationId: reservationId,
          videoId,
        },
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

  private assertCapacityAllowsUpload(
    capacity: PrivateVideoUploadCapacity
  ): void {
    if (capacity.itemLimitReached) {
      throw new Error(
        `Seu plano permite ${capacity.maxItems} vídeo(s) e não possui vaga disponível.`
      );
    }

    if (capacity.byteLimitReached || !capacity.canStartUpload) {
      throw new Error(
        'Seu plano não possui armazenamento disponível para outro vídeo.'
      );
    }
  }

  private validateFileIdentity(file: File): VideoUploadFormat {
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

    return format;
  }

  private validateFileSize(file: File, maxSourceBytes: number): void {
    if (file.size > maxSourceBytes) {
      throw new Error(
        `O vídeo excede o limite de ${this.formatMegabytes(maxSourceBytes)}.`
      );
    }
  }

  private validateSourceDuration(
    durationMs: number | null,
    capacity: PrivateVideoUploadCapacity
  ): void {
    if (!durationMs) {
      throw new Error(
        'Este navegador não conseguiu confirmar a duração do vídeo.'
      );
    }

    if (
      durationMs < capacity.minDurationMs ||
      durationMs > capacity.maxDurationMs
    ) {
      throw new Error(
        `O vídeo deve ter entre ${Math.round(capacity.minDurationMs / 1000)} e ` +
        `${Math.round(capacity.maxDurationMs / 1000)} segundos.`
      );
    }
  }

  private validateOptionalPoster(
    value: Blob | null | undefined,
    maxPosterBytes: number
  ): Blob | null {
    if (!value) {
      return null;
    }

    if (value.type !== 'image/jpeg') {
      throw new Error('A capa escolhida precisa ser gerada em JPEG.');
    }

    if (!Number.isFinite(value.size) || value.size <= 0) {
      throw new Error('A capa escolhida está vazia.');
    }

    if (value.size > maxPosterBytes) {
      throw new Error(
        `A capa escolhida excede o limite de ${this.formatMegabytes(maxPosterBytes)}.`
      );
    }

    return value;
  }

  private normalizeEditRecipe(
    requested: IVideoEditRecipeInput,
    metadata: IPreparedVideoMetadata,
    capacity: PrivateVideoUploadCapacity
  ): IVideoEditRecipeInput {
    const durationMs = metadata.durationMs;
    const trimStartMs = Math.max(0, Math.trunc(Number(requested.trimStartMs)));
    const rawEnd = requested.trimEndMs;
    const trimEndMs = rawEnd === null
      ? null
      : Math.trunc(Number(rawEnd));
    const aspectRatio = this.normalizeAspectRatio(requested.aspectRatio);
    const sourceWidthPixels = metadata.widthPixels ??
      this.positiveInteger(requested.sourceWidthPixels);
    const sourceHeightPixels = metadata.heightPixels ??
      this.positiveInteger(requested.sourceHeightPixels);

    if (!Number.isFinite(trimStartMs)) {
      throw new Error('O início do corte é inválido.');
    }

    if (trimEndMs !== null && !Number.isFinite(trimEndMs)) {
      throw new Error('O fim do corte é inválido.');
    }

    if ((trimStartMs > 0 || trimEndMs !== null) && !durationMs) {
      throw new Error(
        'Este navegador não conseguiu confirmar a duração para aplicar o corte.'
      );
    }

    if (durationMs) {
      const effectiveEnd = trimEndMs ?? durationMs;

      if (
        trimStartMs >= durationMs ||
        effectiveEnd > durationMs ||
        effectiveEnd <= trimStartMs
      ) {
        throw new Error('Revise os pontos inicial e final do corte.');
      }

      if (effectiveEnd - trimStartMs < capacity.minDurationMs) {
        throw new Error(
          `O vídeo editado precisa ter pelo menos ` +
          `${Math.round(capacity.minDurationMs / 1000)} segundos.`
        );
      }
    }

    if (
      aspectRatio !== 'ORIGINAL' &&
      (!sourceWidthPixels || !sourceHeightPixels)
    ) {
      throw new Error(
        'Este navegador não conseguiu confirmar as dimensões para alterar o enquadramento.'
      );
    }

    return {
      version: 1,
      trimStartMs,
      trimEndMs,
      aspectRatio,
      muteAudio: requested.muteAudio === true,
      orientation: 'AUTO',
      sourceWidthPixels,
      sourceHeightPixels,
    };
  }

  private normalizeAspectRatio(value: unknown): TVideoEditAspectRatio {
    const normalized = String(value ?? '').trim().toUpperCase();

    if (
      normalized === 'VERTICAL_9_16' ||
      normalized === 'PORTRAIT_4_5' ||
      normalized === 'SQUARE_1_1'
    ) {
      return normalized;
    }

    return 'ORIGINAL';
  }

  private positiveInteger(value: unknown): number | null {
    const numberValue = Number(value ?? 0);
    return Number.isFinite(numberValue) && numberValue > 0
      ? Math.trunc(numberValue)
      : null;
  }

  private hasEffectiveEdit(
    recipe: IVideoEditRecipeInput,
    sourceDurationMs: number | null
  ): boolean {
    return recipe.trimStartMs > 0 ||
      (recipe.trimEndMs !== null &&
        (!sourceDurationMs || recipe.trimEndMs < sourceDurationMs)) ||
      recipe.aspectRatio !== 'ORIGINAL' ||
      recipe.muteAudio;
  }

  private normalizePublication(
    publication: IVideoUploadCommand['publication']
  ): IVideoPublicationSettingsInput & { publishWhenReady: true } {
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

  private formatMegabytes(value: number): string {
    return `${Math.round(value / 1024 / 1024)} MB`;
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
      // noop
    }
  }
}
