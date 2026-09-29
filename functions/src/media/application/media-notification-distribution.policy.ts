// functions/src/media/application/media-notification-distribution.policy.ts
// -----------------------------------------------------------------------------
// MEDIA NOTIFICATION DISTRIBUTION POLICY
// -----------------------------------------------------------------------------
// Distribuição opcional de Foto/Vídeo aprovada para conexões bilaterais.
//
// Invariantes:
// - somente transição para APPROVED + PUBLIC/FRIENDS pode distribuir;
// - trendScore não participa de elegibilidade, cadence ou caps;
// - caps abaixo são limites defensivos de custo/ruído, não calibração de produto;
// - dedupe é estável por recipient + owner + mediaType + mediaId;
// - preferência `media=false` suprime criação in-app e push;
// - bloqueio bilateral e lifecycle são revalidados imediatamente antes do write.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export type MediaDistributionType = 'photo' | 'video';
export type MediaDistributionNotificationType =
  | 'media.photo.published'
  | 'media.video.published';

export const MEDIA_NOTIFICATION_DISTRIBUTION_WINDOW_MS =
  24 * 60 * 60 * 1_000;
export const MEDIA_NOTIFICATION_MAX_RECIPIENTS_PER_PUBLICATION = 25;
export const MEDIA_NOTIFICATION_MAX_PER_RECIPIENT_WINDOW = 6;
export const MEDIA_NOTIFICATION_MAX_PER_OWNER_RECIPIENT_WINDOW = 2;

export interface MediaDistributionProjection {
  ownerUid?: unknown;
  mediaType?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
  publishedAt?: unknown;
}

export interface MediaNotificationDeliveryState {
  windowStartedAtMs?: unknown;
  count?: unknown;
  ownerCounts?: unknown;
}

export interface MediaNotificationCapDecision {
  readonly allowed: boolean;
  readonly reason:
    | 'ALLOW'
    | 'RECIPIENT_CAP'
    | 'OWNER_RECIPIENT_CAP';
  readonly nextWindowStartedAtMs: number;
  readonly nextCount: number;
  readonly nextOwnerCounts: Readonly<Record<string, number>>;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeOwnerCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(value as Record<string, unknown>)) {
    const uid = String(key ?? '').trim();
    if (!uid || uid.includes('/') || uid.length > 128) continue;
    const count = normalizeCount(rawCount);
    if (count > 0) result[uid] = count;
  }
  return result;
}

export function resolveMediaDistributionType(
  rawMediaType: unknown,
  mediaCollection?: unknown
): MediaDistributionType | null {
  const mediaType = String(rawMediaType ?? '').trim().toUpperCase();
  const collection = String(mediaCollection ?? '').trim();

  if (mediaType === 'PHOTO' || collection === 'public_photos') return 'photo';
  if (mediaType === 'VIDEO' || collection === 'public_videos') return 'video';
  return null;
}

export function resolveMediaDistributionNotificationType(
  mediaType: MediaDistributionType
): MediaDistributionNotificationType {
  return mediaType === 'photo'
    ? 'media.photo.published'
    : 'media.video.published';
}

export function isMediaDistributionNotificationType(
  value: unknown
): value is MediaDistributionNotificationType {
  const normalized = String(value ?? '').trim();
  return normalized === 'media.photo.published'
    || normalized === 'media.video.published';
}

export function shouldDistributeApprovedMedia(input: {
  before?: MediaDistributionProjection | null;
  after?: MediaDistributionProjection | null;
  mediaCollection?: unknown;
}): boolean {
  const after = input.after;
  if (!after) return false;

  const mediaType = resolveMediaDistributionType(
    after.mediaType,
    input.mediaCollection
  );
  if (!mediaType) return false;

  const visibility = String(after.visibility ?? '').trim().toUpperCase();
  const approved =
    String(after.moderationStatus ?? '').trim().toUpperCase() === 'APPROVED';

  if (!approved || (visibility !== 'PUBLIC' && visibility !== 'FRIENDS')) {
    return false;
  }

  const beforeApproved =
    String(input.before?.moderationStatus ?? '').trim().toUpperCase()
      === 'APPROVED';
  const beforeVisibility =
    String(input.before?.visibility ?? '').trim().toUpperCase();

  // Alteração de caption/score/engagement nunca redistribui. Somente a entrada
  // real em estado distribuível dispara uma vez.
  return !beforeApproved
    || (beforeVisibility !== 'PUBLIC' && beforeVisibility !== 'FRIENDS');
}

export function buildMediaDistributionNotificationId(input: {
  recipientUid: string;
  ownerUid: string;
  mediaType: MediaDistributionType;
  mediaId: string;
}): string {
  const digest = createHash('sha256')
    .update([
      input.recipientUid,
      input.ownerUid,
      input.mediaType,
      input.mediaId,
    ].join('\u001f'))
    .digest('hex')
    .slice(0, 40);

  return `media_distribution_${digest}`;
}

export function evaluateMediaNotificationCaps(input: {
  state?: MediaNotificationDeliveryState | null;
  ownerUid: string;
  nowMs: number;
}): MediaNotificationCapDecision {
  const nowMs = Math.max(0, Math.trunc(Number(input.nowMs) || 0));
  const currentWindowStartedAtMs = Math.max(
    0,
    Math.trunc(Number(input.state?.windowStartedAtMs) || 0)
  );
  const windowExpired =
    !currentWindowStartedAtMs
    || nowMs - currentWindowStartedAtMs >= MEDIA_NOTIFICATION_DISTRIBUTION_WINDOW_MS;

  const windowStartedAtMs = windowExpired
    ? nowMs
    : currentWindowStartedAtMs;
  const count = windowExpired ? 0 : normalizeCount(input.state?.count);
  const ownerCounts = windowExpired
    ? {}
    : normalizeOwnerCounts(input.state?.ownerCounts);
  const ownerCount = ownerCounts[input.ownerUid] ?? 0;

  if (count >= MEDIA_NOTIFICATION_MAX_PER_RECIPIENT_WINDOW) {
    return {
      allowed: false,
      reason: 'RECIPIENT_CAP',
      nextWindowStartedAtMs: windowStartedAtMs,
      nextCount: count,
      nextOwnerCounts: Object.freeze({...ownerCounts}),
    };
  }

  if (ownerCount >= MEDIA_NOTIFICATION_MAX_PER_OWNER_RECIPIENT_WINDOW) {
    return {
      allowed: false,
      reason: 'OWNER_RECIPIENT_CAP',
      nextWindowStartedAtMs: windowStartedAtMs,
      nextCount: count,
      nextOwnerCounts: Object.freeze({...ownerCounts}),
    };
  }

  return {
    allowed: true,
    reason: 'ALLOW',
    nextWindowStartedAtMs: windowStartedAtMs,
    nextCount: count + 1,
    nextOwnerCounts: Object.freeze({
      ...ownerCounts,
      [input.ownerUid]: ownerCount + 1,
    }),
  };
}

export function buildMediaNotificationCopy(
  mediaType: MediaDistributionType
): Readonly<{title: string; body: string}> {
  return mediaType === 'photo'
    ? {
      title: 'Nova foto de uma conexão',
      body: 'Uma de suas conexões publicou uma nova foto.',
    }
    : {
      title: 'Novo vídeo de uma conexão',
      body: 'Uma de suas conexões publicou um novo vídeo.',
    };
}
