import {
  resolveMediaPublicationVisibility,
  type AvailableMediaPublicationVisibility,
} from './media-publication-audience.policy';

/**
 * Registrations must carry a deliberate social audience.
 * The generic resolver permits missing values for legacy readers, but a new
 * video upload must NEVER fall back to PUBLIC without user choice.
 */
export function resolveRequiredVideoUploadAudience(
  value: unknown
): AvailableMediaPublicationVisibility | null {
  if (value !== 'FRIENDS' && value !== 'PUBLIC') return null;
  const decision = resolveMediaPublicationVisibility(value);
  return decision.status === 'AVAILABLE' ? decision.value : null;
}
