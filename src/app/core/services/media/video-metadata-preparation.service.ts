import { Injectable } from '@angular/core';
import { Observable, defer, from } from 'rxjs';

import { TVideoEditAspectRatio } from 'src/app/core/interfaces/media/i-video-edit-recipe';

export interface IPreparedVideoMetadata {
  durationMs: number | null;
  widthPixels: number | null;
  heightPixels: number | null;
  posterBlob: Blob | null;
  posterMimeType: 'image/jpeg' | null;
  playbackReady: boolean;
}

export interface IVideoMetadataPreparationOptions {
  aspectRatio?: TVideoEditAspectRatio;
  preferredTimeMs?: number | null;
}

const METADATA_TIMEOUT_MS = 20_000;
const POSTER_MAX_WIDTH = 1280;
const POSTER_QUALITY = 0.82;
const PUBLIC_PLAYBACK_TYPES = new Set(['video/mp4', 'video/webm']);

@Injectable({ providedIn: 'root' })
export class VideoMetadataPreparationService {
  prepare$(
    file: File,
    options: IVideoMetadataPreparationOptions = {}
  ): Observable<IPreparedVideoMetadata> {
    return defer(() => from(this.prepare(file, options)));
  }

  captureCurrentFrame$(
    video: HTMLVideoElement,
    aspectRatio: TVideoEditAspectRatio = 'ORIGINAL'
  ): Observable<Blob> {
    return defer(() => from(this.captureCurrentFrame(video, aspectRatio)));
  }

  private async prepare(
    file: File,
    options: IVideoMetadataPreparationOptions
  ): Promise<IPreparedVideoMetadata> {
    if (
      typeof document === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return this.emptyResult();
    }

    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    try {
      const metadataLoaded = this.waitForEvent(
        video,
        'loadedmetadata',
        METADATA_TIMEOUT_MS
      );
      video.load();
      await metadataLoaded;

      const durationMs = this.normalizeDuration(video.duration);
      const widthPixels = this.normalizeDimension(video.videoWidth);
      const heightPixels = this.normalizeDimension(video.videoHeight);
      const playbackReady =
        durationMs !== null &&
        widthPixels !== null &&
        heightPixels !== null &&
        PUBLIC_PLAYBACK_TYPES.has(String(file.type ?? '').toLowerCase());
      const posterBlob = playbackReady
        ? await this.capturePosterBestEffort(video, options)
        : null;

      return {
        durationMs,
        widthPixels,
        heightPixels,
        posterBlob,
        posterMimeType: posterBlob ? 'image/jpeg' : null,
        playbackReady,
      };
    } catch {
      return this.emptyResult();
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
  }

  private async captureCurrentFrame(
    video: HTMLVideoElement,
    aspectRatio: TVideoEditAspectRatio
  ): Promise<Blob> {
    if (
      typeof document === 'undefined' ||
      !video ||
      !video.videoWidth ||
      !video.videoHeight ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      throw new Error('Aguarde o quadro do vídeo aparecer antes de escolher a capa.');
    }

    const blob = await this.drawCurrentFrame(video, aspectRatio);

    if (!blob) {
      throw new Error('Não foi possível gerar a capa neste navegador.');
    }

    return blob;
  }

  private async capturePosterBestEffort(
    video: HTMLVideoElement,
    options: IVideoMetadataPreparationOptions
  ): Promise<Blob | null> {
    try {
      if (!video.videoWidth || !video.videoHeight) {
        return null;
      }

      const targetSeconds = this.resolvePosterTime(
        video.duration,
        options.preferredTimeMs
      );

      if (targetSeconds > 0) {
        const seeked = this.waitForEvent(video, 'seeked', 8_000);
        video.currentTime = targetSeconds;
        await seeked;
      } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await this.waitForEvent(video, 'loadeddata', 8_000);
      }

      return await this.drawCurrentFrame(
        video,
        options.aspectRatio ?? 'ORIGINAL'
      );
    } catch {
      return null;
    }
  }

  private async drawCurrentFrame(
    video: HTMLVideoElement,
    aspectRatio: TVideoEditAspectRatio
  ): Promise<Blob | null> {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const crop = this.resolveSourceCrop(
      sourceWidth,
      sourceHeight,
      aspectRatio
    );
    const scale = Math.min(1, POSTER_MAX_WIDTH / crop.width);
    const width = Math.max(1, Math.round(crop.width * scale));
    const height = Math.max(1, Math.round(crop.height * scale));
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      return null;
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(
      video,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      width,
      height
    );

    return await this.canvasToBlob(canvas);
  }

  private resolveSourceCrop(
    width: number,
    height: number,
    aspectRatio: TVideoEditAspectRatio
  ): { x: number; y: number; width: number; height: number } {
    const targetRatio = this.targetRatio(aspectRatio);

    if (!targetRatio) {
      return { x: 0, y: 0, width, height };
    }

    const sourceRatio = width / height;

    if (sourceRatio > targetRatio) {
      const cropWidth = Math.max(1, Math.round(height * targetRatio));
      return {
        x: Math.max(0, Math.round((width - cropWidth) / 2)),
        y: 0,
        width: cropWidth,
        height,
      };
    }

    const cropHeight = Math.max(1, Math.round(width / targetRatio));
    return {
      x: 0,
      y: Math.max(0, Math.round((height - cropHeight) / 2)),
      width,
      height: cropHeight,
    };
  }

  private targetRatio(aspectRatio: TVideoEditAspectRatio): number | null {
    switch (aspectRatio) {
    case 'VERTICAL_9_16':
      return 9 / 16;
    case 'PORTRAIT_4_5':
      return 4 / 5;
    case 'SQUARE_1_1':
      return 1;
    default:
      return null;
    }
  }

  private waitForEvent(
    video: HTMLVideoElement,
    eventName: 'loadedmetadata' | 'loadeddata' | 'seeked',
    timeoutMs: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        video.removeEventListener(eventName, onSuccess);
        video.removeEventListener('error', onError);
        clearTimeout(timeoutId);
      };

      const finish = (callback: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        callback();
      };

      const onSuccess = (): void => finish(resolve);
      const onError = (): void => finish(() => {
        reject(new Error('Falha ao ler o vídeo.'));
      });
      const timeoutId = setTimeout(
        () => finish(() => {
          reject(new Error('Tempo excedido ao ler o vídeo.'));
        }),
        timeoutMs
      );

      video.addEventListener(eventName, onSuccess, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', POSTER_QUALITY);
    });
  }

  private normalizeDuration(durationSeconds: number): number | null {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return null;
    }

    return Math.max(1, Math.round(durationSeconds * 1000));
  }

  private normalizeDimension(value: number): number | null {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    return Math.max(1, Math.round(value));
  }

  private resolvePosterTime(
    durationSeconds: number,
    preferredTimeMs: number | null | undefined
  ): number {
    const preferredSeconds = Number(preferredTimeMs ?? 0) / 1000;

    if (
      Number.isFinite(preferredSeconds) &&
      preferredSeconds > 0 &&
      preferredSeconds < durationSeconds
    ) {
      return Math.min(preferredSeconds + 0.1, durationSeconds - 0.05);
    }

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0.2) {
      return 0;
    }

    return Math.min(
      2,
      Math.max(0.1, durationSeconds * 0.1),
      durationSeconds - 0.05
    );
  }

  private emptyResult(): IPreparedVideoMetadata {
    return {
      durationMs: null,
      widthPixels: null,
      heightPixels: null,
      posterBlob: null,
      posterMimeType: null,
      playbackReady: false,
    };
  }
}
