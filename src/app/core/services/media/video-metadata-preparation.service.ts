import { Injectable } from '@angular/core';
import { Observable, defer, from } from 'rxjs';

export interface IPreparedVideoMetadata {
  durationMs: number | null;
  posterBlob: Blob | null;
  posterMimeType: 'image/jpeg' | null;
  playbackReady: boolean;
}

const METADATA_TIMEOUT_MS = 20_000;
const POSTER_MAX_WIDTH = 1280;
const POSTER_QUALITY = 0.82;
const PUBLIC_PLAYBACK_TYPES = new Set(['video/mp4', 'video/webm']);

@Injectable({ providedIn: 'root' })
export class VideoMetadataPreparationService {
  prepare$(file: File): Observable<IPreparedVideoMetadata> {
    return defer(() => from(this.prepare(file)));
  }

  private async prepare(file: File): Promise<IPreparedVideoMetadata> {
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
      await this.waitForEvent(video, 'loadedmetadata', METADATA_TIMEOUT_MS);

      const durationMs = this.normalizeDuration(video.duration);
      const playbackReady =
        durationMs !== null &&
        PUBLIC_PLAYBACK_TYPES.has(String(file.type ?? '').toLowerCase());
      const posterBlob = playbackReady
        ? await this.capturePosterBestEffort(video)
        : null;

      return {
        durationMs,
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

  private async capturePosterBestEffort(video: HTMLVideoElement): Promise<Blob | null> {
    try {
      if (!video.videoWidth || !video.videoHeight) {
        return null;
      }

      const targetSeconds = this.resolvePosterTime(video.duration);

      if (targetSeconds > 0) {
        const seeked = this.waitForEvent(video, 'seeked', 8_000);
        video.currentTime = targetSeconds;
        await seeked;
      } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await this.waitForEvent(video, 'loadeddata', 8_000);
      }

      const scale = Math.min(1, POSTER_MAX_WIDTH / video.videoWidth);
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) {
        return null;
      }

      canvas.width = width;
      canvas.height = height;
      context.drawImage(video, 0, 0, width, height);

      return await this.canvasToBlob(canvas);
    } catch {
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
      const onError = (): void => finish(() => reject(new Error('Falha ao ler o vídeo.')));
      const timeoutId = setTimeout(
        () => finish(() => reject(new Error('Tempo excedido ao ler o vídeo.'))),
        timeoutMs
      );

      video.addEventListener(eventName, onSuccess, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.load();
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

  private resolvePosterTime(durationSeconds: number): number {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0.2) {
      return 0;
    }

    return Math.min(2, Math.max(0.1, durationSeconds * 0.1), durationSeconds - 0.05);
  }

  private emptyResult(): IPreparedVideoMetadata {
    return {
      durationMs: null,
      posterBlob: null,
      posterMimeType: null,
      playbackReady: false,
    };
  }
}
