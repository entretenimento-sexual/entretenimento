import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';
import type { UploadTask } from 'firebase/storage';
import { Observable, firstValueFrom } from 'rxjs';

import { IVideoEditRecipeInput } from 'src/app/core/interfaces/media/i-video-edit-recipe';
import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { IVideoPublicationSettingsInput } from 'src/app/core/interfaces/media/i-video-publication-config';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { PrivateMediaDraftCapacityService } from './private-media-draft-capacity.service';
import { PrivateMediaReservedUploadService } from './private-media-reserved-upload.service';
import {
  VideoUploadFormat,
  VIDEO_UPLOAD_FORMAT_LABEL,
  resolveVideoUploadFormat,
} from './video-upload-format.policy';
import {
  IVideoUploadFlowEvent,
  VideoUploadProgressPhase,
} from './video-upload-flow.service';

export interface IReplaceEditedVideoCommand {
  ownerUid: string;
  videoId: string;
  currentStoragePath: string;
  file: File;
  posterBlob?: Blob | null;
  durationMs: number | null;
  publication: IVideoPublicationSettingsInput;
  editRecipe: IVideoEditRecipeInput;
}

interface ReplacePrivateVideoUploadRequest
  extends IVideoPublicationSettingsInput {
  ownerUid: string;
  videoId: string;
  reservationId: string;
  currentStoragePath: string;
  videoStoragePath: string;
  posterStoragePath: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  editRecipe: IVideoEditRecipeInput;
}

interface ReplacePrivateVideoUploadResponse {
  videoId: string;
  ownerUid: string;
  status: 'queued' | 'processing' | 'ready';
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  videoStoragePath: string;
  posterStoragePath: string | null;
  createdAt: number;
}

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_POSTER_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_VIDEO_DURATION_MS = 5_000;
const REGISTER_RETRY_DELAY_MS = 650;

class VideoReplacementCancelledError extends Error {
  readonly code = 'media/video-replacement-cancelled';

  constructor() {
    super('Substituição de vídeo cancelada.');
  }
}

@Injectable({ providedIn: 'root' })
export class VideoReplacementUploadFlowService {
  private readonly auth = inject(Auth);
  private readonly functions = inject(Functions);
  private readonly draftCapacity = inject(PrivateMediaDraftCapacityService);
  private readonly reservedUpload = inject(PrivateMediaReservedUploadService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly replaceCallable = httpsCallable<
    ReplacePrivateVideoUploadRequest,
    ReplacePrivateVideoUploadResponse
  >(this.functions, 'replacePrivateVideoUpload');

  replaceEditedVideo$(
    command: IReplaceEditedVideoCommand
  ): Observable<IVideoUploadFlowEvent> {
    return new Observable<IVideoUploadFlowEvent>((observer) => {
      let ownerUid = '';
      let videoId = '';
      let currentStoragePath = '';
      let file: File;
      let sourceFormat: VideoUploadFormat;
      let posterBlob: Blob | null = null;
      let durationMs: number | null = null;

      try {
        ownerUid = this.requireOwnedUid(command.ownerUid);
        videoId = this.requireId(command.videoId, 'Vídeo inválido.');
        currentStoragePath = String(command.currentStoragePath ?? '').trim();
        file = command.file;
        sourceFormat = this.validateFile(file);
        posterBlob = this.validateOptionalPoster(command.posterBlob);
        durationMs = this.normalizeDuration(command.durationMs);

        if (!currentStoragePath) {
          throw new Error('A versão atual do vídeo não foi informada.');
        }
      } catch (error) {
        this.reportError(error, {
          op: 'replaceEditedVideo$.validate',
          hasOwnerUid: !!String(command.ownerUid ?? '').trim(),
          hasVideoId: !!String(command.videoId ?? '').trim(),
          hasFile: !!command.file,
        });
        observer.error(error);
        return undefined;
      }

      const videoPath = this.buildVideoPath(ownerUid, videoId, sourceFormat);
      const posterPath = posterBlob
        ? this.buildPosterPath(ownerUid, videoId)
        : null;
      let reservationId = '';
      let activeTask: UploadTask | null = null;
      let cancelRequested = false;
      let registrationStarted = false;
      let completed = false;
      let cleanupChain = Promise.resolve();

      const scheduleCleanup = (): Promise<void> => {
        cleanupChain = cleanupChain.then(async () => {
          if (!reservationId) return;

          const activeReservationId = reservationId;
          reservationId = '';
          await this.cancelReservationBestEffort(activeReservationId);
        });

        return cleanupChain;
      };

      const assertNotCancelled = (): void => {
        if (cancelRequested) throw new VideoReplacementCancelledError();
      };

      const emitProgress = (
        phase: VideoUploadProgressPhase,
        progress: number
      ): void => observer.next({ type: 'progress', phase, progress });

      const run = async (): Promise<void> => {
        try {
          emitProgress('preparing', 3);
          const reservation = await firstValueFrom(
            this.draftCapacity.reserveUpload$({
              ownerUid,
              mediaId: videoId,
              kind: 'video',
              operation: 'REPLACE',
              sourceStoragePath: videoPath,
              auxiliaryStoragePath: posterPath,
              currentStoragePath,
              sourceSizeBytes: file.size,
              auxiliarySizeBytes: posterBlob?.size ?? 0,
            })
          );
          reservationId = reservation.reservationId;
          assertNotCancelled();

          const videoBinary = await firstValueFrom(
            this.reservedUpload.upload$(
              videoPath,
              file,
              sourceFormat.mimeType,
              reservationId,
              (progress) => emitProgress(
                'uploading-video',
                this.mapProgress(progress, 4, posterBlob ? 86 : 96)
              ),
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
                (progress) => emitProgress(
                  'uploading-poster',
                  this.mapProgress(progress, 86, 96)
                ),
                (task) => {
                  activeTask = task;
                }
              )
            );
            uploadedPosterPath = posterBinary.storagePath;
            activeTask = null;
            assertNotCancelled();
          }

          emitProgress('saving', 98);
          registrationStarted = true;
          const registration = await this.registerReplacement({
            ownerUid,
            videoId,
            reservationId,
            currentStoragePath,
            videoStoragePath: videoBinary.storagePath,
            posterStoragePath: uploadedPosterPath,
            fileName: this.normalizeDisplayFileName(file.name),
            mimeType: sourceFormat.mimeType,
            sizeBytes: file.size,
            durationMs,
            editRecipe: command.editRecipe,
            ...this.normalizePublication(command.publication),
          });

          completed = true;
          reservationId = '';
          emitProgress('saving', 100);
          observer.next({
            type: 'success',
            result: {
              id: registration.videoId,
              ownerUid: registration.ownerUid,
              url: registration.videoStoragePath,
              path: registration.videoStoragePath,
              fileName: this.normalizeDisplayFileName(file.name),
              mimeType: registration.mimeType,
              sizeBytes: registration.sizeBytes,
              sourceMimeType: registration.mimeType,
              sourceSizeBytes: registration.sizeBytes,
              durationMs: registration.durationMs,
              thumbnailUrl: registration.posterStoragePath,
              thumbnailPath: registration.posterStoragePath,
              processingStage: registration.status === 'ready'
                ? 'ready'
                : registration.status,
              status: registration.status,
              createdAt: registration.createdAt,
              updatedAt: null,
            } as IVideoItem,
          });
          observer.complete();

          this.privacyDebug.log(
            'media',
            'VideoReplacementUpload: substituição registrada',
            {
              hasOwnerUid: true,
              hasVideoId: true,
              hasPoster: !!uploadedPosterPath,
              sizeBytes: registration.sizeBytes,
            }
          );
        } catch (error) {
          activeTask = null;

          if (!completed && !registrationStarted) {
            await scheduleCleanup();
          }

          if (
            cancelRequested ||
            error instanceof VideoReplacementCancelledError
          ) {
            return;
          }

          this.reportError(error, {
            op: 'replaceEditedVideo$',
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
        if (completed || registrationStarted) return;

        cancelRequested = true;
        activeTask?.cancel();
        void scheduleCleanup();
      };
    });
  }

  private async registerReplacement(
    payload: ReplacePrivateVideoUploadRequest
  ): Promise<ReplacePrivateVideoUploadResponse> {
    try {
      const response = await this.replaceCallable(payload);
      return response.data;
    } catch (error) {
      if (!this.isRetryableRegistrationError(error)) throw error;

      await this.delay(REGISTER_RETRY_DELAY_MS);
      const retry = await this.replaceCallable(payload);
      return retry.data;
    }
  }

  private normalizePublication(
    publication: IVideoPublicationSettingsInput
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

  private requireOwnedUid(ownerUid: string): string {
    const safeOwnerUid = this.requireId(
      ownerUid,
      'Perfil inválido para substituição do vídeo.'
    );
    const authenticatedUid = this.auth.currentUser?.uid?.trim() ?? '';

    if (!authenticatedUid || authenticatedUid !== safeOwnerUid) {
      throw new Error('A substituição deve ocorrer no perfil autenticado.');
    }

    return safeOwnerUid;
  }

  private requireId(value: unknown, message: string): string {
    const normalized = String(value ?? '').trim();

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
      throw new Error(message);
    }

    return normalized;
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
    if (!value) return null;

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

  private normalizeDuration(value: unknown): number | null {
    if (value === null || value === undefined) return null;

    const durationMs = Number(value);

    if (!Number.isFinite(durationMs) || durationMs < MIN_VIDEO_DURATION_MS) {
      throw new Error('O vídeo precisa ter pelo menos 5 segundos.');
    }

    return Math.trunc(durationMs);
  }

  private buildVideoPath(
    ownerUid: string,
    videoId: string,
    format: VideoUploadFormat
  ): string {
    return `users/${ownerUid}/uploads/videos/` +
      `${videoId}-${this.randomId()}.${format.extension}`;
  }

  private buildPosterPath(ownerUid: string, videoId: string): string {
    return `users/${ownerUid}/uploads/video-posters/${videoId}/` +
      `poster-${this.randomId()}.jpg`;
  }

  private normalizeDisplayFileName(value: string): string {
    return String(value ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 160) || 'Vídeo';
  }

  private mapProgress(value: number, start: number, end: number): number {
    const normalized = Math.max(0, Math.min(100, Number(value) || 0));
    return Math.round(start + ((end - start) * normalized) / 100);
  }

  private cancelReservationBestEffort(reservationId: string): Promise<void> {
    return firstValueFrom(
      this.draftCapacity.cancelUploadReservation$(reservationId)
    ).then(() => undefined).catch(() => undefined);
  }

  private isRetryableRegistrationError(error: unknown): boolean {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
        .trim()
        .toLowerCase()
        .replace(/^functions\//, '')
      : '';

    return [
      'deadline-exceeded',
      'internal',
      'unavailable',
      'unknown',
    ].includes(code);
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

  private reportError(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha no fluxo de substituição do vídeo.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'VideoReplacementUploadFlowService',
        ...context,
      };
      (normalized as any).skipUserNotification = true;
      this.errorHandler.handleError(normalized);
    } catch {
      // A falha de observabilidade não substitui o erro original.
    }
  }
}
