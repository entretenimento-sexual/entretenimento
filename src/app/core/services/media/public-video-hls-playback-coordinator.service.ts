import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Subscription, forkJoin } from 'rxjs';
import { take } from 'rxjs/operators';

import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  PublicVideoHlsAccessService,
  type IPublicVideoHlsAccess,
} from './public-video-hls-access.service';
import {
  PublicVideoHlsRuntimeService,
  type HlsRuntimeErrorData,
  type HlsRuntimeInstance,
} from './public-video-hls-runtime.service';

export interface PublicVideoHlsPlaybackConnection {
  refresh(): void;
  destroy(): void;
}

interface PlaybackSnapshot {
  currentTime: number;
  shouldResume: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
}

interface MaterializedHlsSession {
  masterUrl: string;
  objectUrls: string[];
}

const HLS_MIME_TYPE = 'application/vnd.apple.mpegurl';
const HLS_RUNTIME_CONFIG: Record<string, unknown> = {
  enableWorker: true,
  lowLatencyMode: false,
  capLevelToPlayerSize: true,
  backBufferLength: 30,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  startLevel: -1,
};

function safeCurrentTime(video: HTMLVideoElement): number {
  const currentTime = Number(video.currentTime);
  return Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
}

function capturePlayback(video: HTMLVideoElement): PlaybackSnapshot {
  return {
    currentTime: safeCurrentTime(video),
    shouldResume: !video.paused && !video.ended,
    muted: video.muted,
    volume: Number.isFinite(video.volume) ? video.volume : 1,
    playbackRate: Number.isFinite(video.playbackRate)
      ? video.playbackRate
      : 1,
  };
}

function restorePlayback(
  video: HTMLVideoElement,
  snapshot: PlaybackSnapshot
): void {
  video.muted = snapshot.muted;
  video.volume = Math.max(0, Math.min(1, snapshot.volume));
  video.playbackRate = Math.max(0.25, Math.min(4, snapshot.playbackRate));

  if (snapshot.currentTime > 0 && Number.isFinite(video.duration)) {
    try {
      video.currentTime = Math.min(
        snapshot.currentTime,
        Math.max(0, video.duration - 0.05)
      );
    } catch {
      // O navegador pode recusar seek antes de carregar metadados suficientes.
    }
  }

  if (snapshot.shouldResume) {
    void video.play().catch(() => undefined);
  }
}

function isBlobUrl(value: string): boolean {
  return String(value ?? '').trim().toLowerCase().startsWith('blob:');
}

@Injectable({ providedIn: 'root' })
export class PublicVideoHlsPlaybackCoordinatorService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  constructor(
    private readonly hlsAccess: PublicVideoHlsAccessService,
    private readonly hlsRuntime: PublicVideoHlsRuntimeService,
    private readonly errorHandler: GlobalErrorHandlerService
  ) {}

  connect(
    video: HTMLVideoElement,
    resolveItem: () => IPublicVideoItem | null
  ): PublicVideoHlsPlaybackConnection {
    if (!isPlatformBrowser(this.platformId)) {
      return {
        refresh: () => undefined,
        destroy: () => undefined,
      };
    }

    let destroyed = false;
    let generation = 0;
    let hls: HlsRuntimeInstance | null = null;
    let subscription: Subscription | null = null;
    let sourceObserver: MutationObserver | null = null;
    let objectUrls: string[] = [];
    let suppressSourceObservation = false;
    let networkRecoveryAttempted = false;
    let mediaRecoveryAttempted = false;
    let accessRefreshAttempted = false;

    const releaseObjectUrls = (): void => {
      for (const objectUrl of objectUrls) {
        URL.revokeObjectURL(objectUrl);
      }

      objectUrls = [];
    };

    const destroyRuntime = (): void => {
      subscription?.unsubscribe();
      subscription = null;
      hls?.destroy();
      hls = null;
      releaseObjectUrls();
      networkRecoveryAttempted = false;
      mediaRecoveryAttempted = false;
      delete video.dataset['playbackMode'];
    };

    const mutateSource = (url: string): void => {
      suppressSourceObservation = true;
      video.src = url;
      queueMicrotask(() => {
        suppressSourceObservation = false;
      });
    };

    const fallbackToMp4 = (
      item: IPublicVideoItem,
      snapshot: PlaybackSnapshot,
      reason: string
    ): void => {
      const fallbackGeneration = ++generation;
      destroyRuntime();
      accessRefreshAttempted = false;

      if (destroyed || fallbackGeneration !== generation) {
        return;
      }

      video.dataset['playbackMode'] = 'mp4';
      mutateSource(item.url);
      video.load();
      video.addEventListener(
        'loadedmetadata',
        () => restorePlayback(video, snapshot),
        { once: true }
      );
      this.reportDiagnostic(reason, item, null);
    };

    const materialize = (
      access: IPublicVideoHlsAccess
    ): MaterializedHlsSession => {
      const createdUrls: string[] = [];
      let masterManifest = access.masterManifest;

      try {
        for (const playlist of access.playlists) {
          const playlistUrl = URL.createObjectURL(new Blob(
            [playlist.manifest],
            { type: HLS_MIME_TYPE }
          ));
          createdUrls.push(playlistUrl);
          masterManifest = masterManifest.split(playlist.placeholder).join(
            playlistUrl
          );
        }

        if (/__ENTRETENIMENTO_HLS_PLAYLIST_\d+__/.test(masterManifest)) {
          throw new Error('Manifest HLS contém playlist não materializada.');
        }

        const masterUrl = URL.createObjectURL(new Blob(
          [masterManifest],
          { type: HLS_MIME_TYPE }
        ));
        createdUrls.push(masterUrl);

        return { masterUrl, objectUrls: createdUrls };
      } catch (error) {
        for (const objectUrl of createdUrls) {
          URL.revokeObjectURL(objectUrl);
        }

        throw error;
      }
    };

    const setup = (
      forceRefresh = false,
      playbackSnapshot?: PlaybackSnapshot,
      alreadyRefreshedAccess = false
    ): void => {
      const item = resolveItem();

      if (
        destroyed ||
        !item ||
        !item.ownerUid?.trim() ||
        !item.id?.trim() ||
        !item.url?.trim() ||
        globalThis.navigator?.onLine === false
      ) {
        return;
      }

      const setupGeneration = ++generation;
      const snapshot = playbackSnapshot ?? capturePlayback(video);
      destroyRuntime();
      accessRefreshAttempted = alreadyRefreshedAccess;

      subscription = forkJoin({
        runtime: this.hlsRuntime.load$().pipe(take(1)),
        access: this.hlsAccess.getAccess$(
          item.ownerUid,
          item.id,
          forceRefresh
        ).pipe(take(1)),
      }).subscribe({
        next: ({ runtime, access }) => {
          if (
            destroyed ||
            setupGeneration !== generation ||
            !runtime ||
            !runtime.isSupported() ||
            !access
          ) {
            return;
          }

          try {
            const session = materialize(access);
            objectUrls = session.objectUrls;
            hls = new runtime(HLS_RUNTIME_CONFIG);
            video.dataset['playbackMode'] = 'hls';

            hls.on(runtime.Events.MEDIA_ATTACHED, () => {
              if (
                destroyed ||
                setupGeneration !== generation ||
                !hls
              ) {
                return;
              }

              hls.loadSource(session.masterUrl);
            });
            hls.on(runtime.Events.MANIFEST_PARSED, () => {
              if (destroyed || setupGeneration !== generation) {
                return;
              }

              restorePlayback(video, snapshot);
            });
            hls.on(
              runtime.Events.ERROR,
              (_eventName: string, data: HlsRuntimeErrorData) => {
                if (
                  destroyed ||
                  setupGeneration !== generation ||
                  !data?.fatal ||
                  !hls
                ) {
                  return;
                }

                const responseCode = Number(data.response?.code ?? 0);
                const accessExpired =
                  access.expiresAt <= Date.now() + 60_000;
                const unauthorized = responseCode === 401 || responseCode === 403;

                if (
                  data.type === runtime.ErrorTypes.NETWORK_ERROR &&
                  (unauthorized || accessExpired) &&
                  !accessRefreshAttempted
                ) {
                  this.hlsAccess.invalidate(item.ownerUid, item.id);
                  setup(true, capturePlayback(video), true);
                  return;
                }

                if (
                  data.type === runtime.ErrorTypes.NETWORK_ERROR &&
                  !networkRecoveryAttempted
                ) {
                  networkRecoveryAttempted = true;
                  hls.startLoad(safeCurrentTime(video));
                  return;
                }

                if (
                  data.type === runtime.ErrorTypes.MEDIA_ERROR &&
                  !mediaRecoveryAttempted
                ) {
                  mediaRecoveryAttempted = true;
                  hls.recoverMediaError();
                  return;
                }

                fallbackToMp4(
                  item,
                  capturePlayback(video),
                  'Falha fatal na sessão HLS; fallback MP4 aplicado.'
                );
              }
            );
            hls.attachMedia(video);
          } catch (error) {
            this.reportDiagnostic(
              'Falha ao materializar sessão HLS; fallback MP4 mantido.',
              item,
              error
            );
          }
        },
        error: (error) => {
          this.reportDiagnostic(
            'Falha ao iniciar sessão HLS; fallback MP4 mantido.',
            item,
            error
          );
        },
      });
    };

    sourceObserver = new MutationObserver(() => {
      if (destroyed || suppressSourceObservation) {
        return;
      }

      const declaredSource = video.getAttribute('src') || video.src;

      if (isBlobUrl(declaredSource) && hls) {
        return;
      }

      setup(false);
    });
    sourceObserver.observe(video, {
      attributes: true,
      attributeFilter: ['src'],
    });
    queueMicrotask(() => setup(false));

    return {
      refresh: () => {
        const item = resolveItem();

        if (!item) {
          return;
        }

        this.hlsAccess.invalidate(item.ownerUid, item.id);
        setup(true, capturePlayback(video), true);
      },
      destroy: () => {
        if (destroyed) {
          return;
        }

        destroyed = true;
        generation += 1;
        sourceObserver?.disconnect();
        sourceObserver = null;
        destroyRuntime();
      },
    };
  }

  private reportDiagnostic(
    message: string,
    item: IPublicVideoItem,
    error: unknown
  ): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error(message);

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'PublicVideoHlsPlaybackCoordinatorService',
        ownerUid: item.ownerUid,
        videoId: item.id,
        playbackMode: 'hls',
        message,
      };
      (normalizedError as any).skipUserNotification = true;
      this.errorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
