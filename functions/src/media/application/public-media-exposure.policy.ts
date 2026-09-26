import {
  canReadPublishedPhotoAudience,
} from './photo-audience-access.policy';
import {
  publicAgeProjectionValidUntilMs,
} from './public-media-age-expiry.policy';

export type PublicMediaOwnerExposureDenialReason =
  | 'OWNER_NOT_PUBLIC'
  | 'OWNER_AGE_PROJECTION_UNAVAILABLE'
  | 'OWNER_AGE_PROJECTION_EXPIRED'
  | 'OWNER_AGE_NOT_CANONICAL'
  | 'OWNER_AGE_CANONICAL_EXPIRED'
  | 'BILATERAL_BLOCK';

export interface PublicMediaOwnerExposureDecision {
  readonly allowed: boolean;
  readonly validUntilMs: number | null;
  readonly denialReason: PublicMediaOwnerExposureDenialReason | null;
}

interface PublicMediaOwnerExposureInput {
  readonly publicProfile: Record<string, unknown> | null | undefined;
  readonly viewerBlocked: boolean;
  readonly nowMs: number;
}

interface PublicMediaSignedOwnerExposureInput
  extends PublicMediaOwnerExposureInput {
  readonly canonicalAgeAllowed: boolean;
  readonly canonicalAgeExpiresAtMs: number | null;
}

interface PublicMediaAssetExposureInput {
  readonly publicMedia: Record<string, unknown> | null | undefined;
  readonly publication: Record<string, unknown> | null | undefined;
  readonly ownerExposureAllowed: boolean;
  readonly nowMs: number;
  readonly allowedVisibilities: readonly string[];
}

interface PublicPhotoAssetExposureInput
  extends Omit<PublicMediaAssetExposureInput, 'allowedVisibilities'> {
  readonly viewerIsOwner: boolean;
  readonly viewerIsFriend: boolean;
}

function normalizedUpper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function epochMillis(value: unknown): number | null {
  const direct = Number(value);

  if (Number.isFinite(direct) && direct > 0) {
    return Math.trunc(direct);
  }

  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    try {
      const millis = (value as { toMillis: () => number }).toMillis();
      return Number.isFinite(millis) && millis > 0
        ? Math.trunc(millis)
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Base canônica de exposição do proprietário.
 *
 * Suspensão, exclusão, ocultação e outras transições de lifecycle retiram
 * public_profiles/{uid}; portanto a presença de uma projeção pública adulta
 * vigente é pré-condição de qualquer distribuição. Bloqueio bilateral é
 * aplicado na mesma fronteira antes de discovery/ranking/boost ou acesso.
 */
export function evaluatePublicMediaOwnerExposure(
  input: PublicMediaOwnerExposureInput
): PublicMediaOwnerExposureDecision {
  if (input.viewerBlocked) {
    return {
      allowed: false,
      validUntilMs: null,
      denialReason: 'BILATERAL_BLOCK',
    };
  }

  if (!input.publicProfile) {
    return {
      allowed: false,
      validUntilMs: null,
      denialReason: 'OWNER_NOT_PUBLIC',
    };
  }

  const validUntilMs = publicAgeProjectionValidUntilMs(input.publicProfile);

  if (validUntilMs === null) {
    return {
      allowed: false,
      validUntilMs: null,
      denialReason: 'OWNER_AGE_PROJECTION_UNAVAILABLE',
    };
  }

  if (validUntilMs <= input.nowMs) {
    return {
      allowed: false,
      validUntilMs,
      denialReason: 'OWNER_AGE_PROJECTION_EXPIRED',
    };
  }

  return {
    allowed: true,
    validUntilMs,
    denialReason: null,
  };
}

/**
 * URL assinada é a última fronteira e, além da base pública comum, revalida o
 * registro etário canônico do proprietário. O prazo final nunca ultrapassa a
 * menor validade entre projeção pública e autoridade etária.
 */
export function evaluatePublicMediaSignedOwnerExposure(
  input: PublicMediaSignedOwnerExposureInput
): PublicMediaOwnerExposureDecision {
  const base = evaluatePublicMediaOwnerExposure(input);

  if (!base.allowed || base.validUntilMs === null) {
    return base;
  }

  if (!input.canonicalAgeAllowed) {
    return {
      allowed: false,
      validUntilMs: null,
      denialReason: 'OWNER_AGE_NOT_CANONICAL',
    };
  }

  const canonicalValidUntilMs =
    input.canonicalAgeExpiresAtMs === null
      ? Number.POSITIVE_INFINITY
      : Number(input.canonicalAgeExpiresAtMs);

  if (
    Number.isNaN(canonicalValidUntilMs) ||
    canonicalValidUntilMs <= input.nowMs
  ) {
    return {
      allowed: false,
      validUntilMs: Number.isFinite(canonicalValidUntilMs)
        ? canonicalValidUntilMs
        : null,
      denialReason: 'OWNER_AGE_CANONICAL_EXPIRED',
    };
  }

  return {
    allowed: true,
    validUntilMs: Math.min(base.validUntilMs, canonicalValidUntilMs),
    denialReason: null,
  };
}

/**
 * Política comum de projeção distribuível. Ranking e discovery trabalham só
 * com APPROVED + maioridade pública vigente; audiências aceitas são explícitas
 * por superfície.
 */
export function isCurrentPublicMediaProjectionExposure(
  data: Record<string, unknown> | null | undefined,
  nowMs: number,
  allowedVisibilities: readonly string[] = ['PUBLIC']
): boolean {
  if (!data) return false;

  const validUntilMs = publicAgeProjectionValidUntilMs(data);
  const visibility = normalizedUpper(data['visibility']);
  const allowed = new Set(
    allowedVisibilities.map((value) => normalizedUpper(value))
  );

  return validUntilMs !== null
    && validUntilMs > nowMs
    && allowed.has(visibility)
    && normalizedUpper(data['moderationStatus']) === 'APPROVED';
}

export function isCurrentPublicMediaBoostExposure(
  data: Record<string, unknown> | null | undefined,
  nowMs: number
): boolean {
  if (!isCurrentPublicMediaProjectionExposure(data, nowMs, ['PUBLIC'])) {
    return false;
  }

  const boostedUntilMs = epochMillis(data?.['boostedUntil']);

  return data?.['boostActive'] === true
    && boostedUntilMs !== null
    && boostedUntilMs > nowMs;
}

/**
 * Revalida a projeção e a publicação autoritativa imediatamente antes de
 * liberar o ativo. Isso impede que uma projeção atrasada mantenha acesso após
 * unpublish, troca de audiência ou reabertura de moderação preventiva.
 */
export function isCurrentPublicMediaAssetExposure(
  input: PublicMediaAssetExposureInput
): boolean {
  if (
    !input.ownerExposureAllowed ||
    !input.publicMedia ||
    !input.publication ||
    !isCurrentPublicMediaProjectionExposure(
      input.publicMedia,
      input.nowMs,
      input.allowedVisibilities
    ) ||
    input.publication['isPublished'] !== true
  ) {
    return false;
  }

  const projectionVisibility = normalizedUpper(
    input.publicMedia['visibility']
  );
  const publicationVisibility = normalizedUpper(
    input.publication['visibility']
  );

  return publicationVisibility === projectionVisibility
    && normalizedUpper(input.publication['moderationStatus']) === 'APPROVED';
}

export function isCurrentPublicPhotoAssetExposure(
  input: PublicPhotoAssetExposureInput
): boolean {
  if (
    !isCurrentPublicMediaAssetExposure({
      ...input,
      allowedVisibilities: ['PUBLIC', 'FRIENDS'],
    })
  ) {
    return false;
  }

  return canReadPublishedPhotoAudience({
    visibility: normalizedUpper(input.publicMedia?.['visibility']),
    viewerIsOwner: input.viewerIsOwner,
    viewerIsFriend: input.viewerIsFriend,
  });
}
