import type {
  IPublicVideoAccessVariant,
  TPublicVideoQuality,
} from 'src/app/core/interfaces/media/i-public-video-item';
import type {
  PublicVideoMetadataPreloadCapability,
} from './public-video-playback-capability';

const DATA_SAVER_MAX_DOWNLINK_MBPS = 3;
const BLOCKED_HD_EFFECTIVE_TYPES = new Set(['slow-2g', '2g', '3g']);

function normalizeQuality(value: unknown): TPublicVideoQuality | null {
  const quality = String(value ?? '').trim().toUpperCase();
  return quality === 'SD' || quality === 'HD' ? quality : null;
}

export function shouldPreferPublicVideoSd(
  capability: PublicVideoMetadataPreloadCapability
): boolean {
  const effectiveType = String(capability.effectiveType ?? '')
    .trim()
    .toLowerCase();
  const downlinkMbps = Number(capability.downlinkMbps);
  const hasConstrainedMeasuredDownlink =
    Number.isFinite(downlinkMbps) &&
    downlinkMbps > 0 &&
    downlinkMbps < DATA_SAVER_MAX_DOWNLINK_MBPS;

  return capability.saveData ||
    BLOCKED_HD_EFFECTIVE_TYPES.has(effectiveType) ||
    hasConstrainedMeasuredDownlink;
}

export function selectPublicVideoAccessVariant(
  variants: readonly IPublicVideoAccessVariant[],
  defaultQuality: unknown,
  capability: PublicVideoMetadataPreloadCapability
): IPublicVideoAccessVariant | null {
  if (!variants.length) {
    return null;
  }

  const byQuality = new Map<TPublicVideoQuality, IPublicVideoAccessVariant>();

  for (const variant of variants) {
    const quality = normalizeQuality(variant.quality);

    if (quality && !byQuality.has(quality)) {
      byQuality.set(quality, variant);
    }
  }

  if (!byQuality.size) {
    return variants[0] ?? null;
  }

  if (shouldPreferPublicVideoSd(capability) && byQuality.has('SD')) {
    return byQuality.get('SD')!;
  }

  const normalizedDefault = normalizeQuality(defaultQuality);

  if (normalizedDefault && byQuality.has(normalizedDefault)) {
    return byQuality.get(normalizedDefault)!;
  }

  return byQuality.get('HD') ?? byQuality.get('SD') ?? variants[0] ?? null;
}
