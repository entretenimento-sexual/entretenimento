import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  InjectionToken,
  inject,
} from '@angular/core';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

export interface PublicVideoMetadataPreloadCapability {
  readonly documentVisible: boolean;
  readonly online: boolean;
  readonly saveData: boolean;
  readonly effectiveType: string | null;
  readonly downlinkMbps: number | null;
}

export type PublicVideoMetadataPreloadCapabilityReader =
  () => PublicVideoMetadataPreloadCapability;

interface NavigatorWithConnection extends Navigator {
  readonly connection?: {
    readonly saveData?: boolean;
    readonly effectiveType?: string;
    readonly downlink?: number;
  };
}

const ACCESS_EXPIRY_SAFETY_MS = 30_000;
const METADATA_PRELOAD_TIMEOUT_MS = 8_000;
const MIN_DOWNLINK_MBPS = 1.5;
const BLOCKED_EFFECTIVE_TYPES = new Set(['slow-2g', '2g']);

export function canPreloadPublicVideoMetadata(
  capability: PublicVideoMetadataPreloadCapability
): boolean {
  const effectiveType = String(capability.effectiveType ?? '')
    .trim()
    .toLowerCase();
  const downlinkMbps = Number(capability.downlinkMbps);
  const hasInsufficientMeasuredDownlink =
    Number.isFinite(downlinkMbps) &&
    downlinkMbps > 0 &&
    downlinkMbps < MIN_DOWNLINK_MBPS;

  return capability.documentVisible &&
    capability.online &&
    !capability.saveData &&
    !BLOCKED_EFFECTIVE_TYPES.has(effectiveType) &&
    !hasInsufficientMeasuredDownlink;
}

export const PUBLIC_VIDEO_METADATA_PRELOAD_CAPABILITY_READER =
  new InjectionToken<PublicVideoMetadataPreloadCapabilityReader>(
    'PUBLIC_VIDEO_METADATA_PRELOAD_CAPABILITY_READER',
    {
      factory: () => {
        const document = inject(DOCUMENT);

        return () => {
          const navigatorLike = globalThis.navigator as
            NavigatorWithConnection | undefined;
          const downlink = Number(navigatorLike?.connection?.downlink);

          return {
            documentVisible: document.visibilityState !== 'hidden',
            online: navigatorLike?.onLine !== false,
            saveData: navigatorLike?.connection?.saveData === true,
            effectiveType:
              String(
                navigatorLike?.connection?.effectiveType ?? ''
              ).trim() || null,
            downlinkMbps:
              Number.isFinite(downlink) && downlink > 0
                ? downlink
                : null,
          };
        };
      },
    }
  );

@Injectable({ providedIn: 'root' })
export class PublicVideoMetadataPreloadService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly readCapability = inject(
    PUBLIC_VIDEO_METADATA_PRELOAD_CAPABILITY_READER
  );

  private readonly attemptedKeys = new Set<string>();
  private readonly activeCleanups = new Map<string, () => void>();

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const cleanup of this.activeCleanups.values()) {
        cleanup();
      }
      this.activeCleanups.clear();
    });
  }

  /**
   * Prepara somente metadados do vídeo já autorizado.
   *
   * Segurança e métricas:
   * - não chama backend;
   * - não executa play();
   * - não registra visualização;
   * - não persiste URL assinada;
   * - não exibe toast em falha especulativa.
   */
  preloadMetadata(item: IPublicVideoItem | null | undefined): boolean {
    const key = this.buildKey(item);

    if (
      !key ||
      this.attemptedKeys.has(key) ||
      !canPreloadPublicVideoMetadata(this.readCapability()) ||
      !this.hasUsableAccess(item)
    ) {
      return false;
    }

    let video: HTMLVideoElement;

    try {
      video = this.document.createElement('video');
    } catch (error) {
      this.debug('create-element-failed', item, error);
      return false;
    }

    this.attemptedKeys.add(key);

    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;

      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
      this.activeCleanups.delete(key);

      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // A limpeza é best-effort e não deve afetar a navegação.
      }
    };

    const onLoadedMetadata = (): void => {
      this.debug('metadata-ready', item);
      cleanup();
    };

    const onError = (event: Event): void => {
      this.debug('metadata-error', item, event.type);
      cleanup();
    };

    this.activeCleanups.set(key, cleanup);
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    video.addEventListener('error', onError, { once: true });

    timeoutId = setTimeout(() => {
      this.debug('metadata-timeout', item);
      cleanup();
    }, METADATA_PRELOAD_TIMEOUT_MS);

    try {
      video.src = item!.url;
      video.load();
      return true;
    } catch (error) {
      this.debug('metadata-start-failed', item, error);
      cleanup();
      return false;
    }
  }

  cancelMetadataPreload(item: IPublicVideoItem | null | undefined): void {
    const key = this.buildKey(item);

    if (!key) {
      return;
    }

    this.activeCleanups.get(key)?.();
  }

  private hasUsableAccess(
    item: IPublicVideoItem | null | undefined
  ): item is IPublicVideoItem {
    const expiresAt = Number(item?.accessExpiresAt ?? 0);

    return !!item?.ownerUid?.trim() &&
      !!item.id?.trim() &&
      !!item.url?.trim() &&
      item.mediaType === 'VIDEO' &&
      item.visibility === 'PUBLIC' &&
      item.moderationStatus === 'APPROVED' &&
      item.assetAccess === 'SIGNED_URL' &&
      Number.isFinite(expiresAt) &&
      expiresAt > Date.now() + ACCESS_EXPIRY_SAFETY_MS;
  }

  private buildKey(
    item: IPublicVideoItem | null | undefined
  ): string {
    const ownerUid = String(item?.ownerUid ?? '').trim();
    const videoId = String(item?.id ?? '').trim();
    const url = String(item?.url ?? '').trim();

    return ownerUid && videoId && url
      ? `${ownerUid}:${videoId}:${url}`
      : '';
  }

  private debug(
    event: string,
    item: IPublicVideoItem | null | undefined,
    extra?: unknown
  ): void {
    this.privacyDebug.log('media', `VideoMetadataPreload: ${event}`, {
      hasOwnerUid: !!item?.ownerUid,
      hasVideoId: !!item?.id,
      ...(extra === undefined ? {} : { extra }),
    });
  }
}
