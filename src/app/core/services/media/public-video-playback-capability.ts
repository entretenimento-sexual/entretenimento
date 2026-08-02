import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';

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
