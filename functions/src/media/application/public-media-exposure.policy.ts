import {
  canReadPublishedPhotoAudience,
} from './photo-audience-access.policy';

export type PublicMediaOwnerExposureDenialReason =
  | 'OWNER_LIFECYCLE_NOT_CANONICAL'
  | 'OWNER_NOT_PUBLIC'
  | 'BILATERAL_BLOCK';

export interface PublicMediaOwnerExposureDecision {
  readonly allowed: boolean;
  readonly validUntilMs: number | null;
  readonly denialReason: PublicMediaOwnerExposureDenialReason | null;
}

interface PublicMediaOwnerExposureInput {
  readonly publicProfile: Record<string, unknown> | null | undefined;
  readonly canonicalOwnerLifecycleAllowed: boolean;
  readonly viewerBlocked: boolean;
  readonly nowMs: number;
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

/**
 * Exposição do proprietário deriva exclusivamente do lifecycle público da
 * conta e do bloqueio bilateral. Assurance etária é atributo da conta e não
 * integra a autoridade de distribuição de cada mídia.
 */
export function evaluatePublicMediaOwnerExposure(
  input: PublicMediaOwnerExposureInput
): PublicMediaOwnerExposureDecision {
  if (!input.canonicalOwnerLifecycleAllowed) {
    return {
      allowed: false,
      validUntilMs: null,
      denialReason: 'OWNER_LIFECYCLE_NOT_CANONICAL',
    };
  }

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

  return {
    allowed: true,
    validUntilMs: null,
    denialReason: null,
  };
}

/**
 * Compatibilidade temporária dos consumidores de URL assinada. Não existe uma
 * segunda fronteira etária para o proprietário.
 */
export function evaluatePublicMediaSignedOwnerExposure(
  input: PublicMediaOwnerExposureInput
): PublicMediaOwnerExposureDecision {
  return evaluatePublicMediaOwnerExposure(input);
}

/**
 * Ranking/discovery dependem da publicação e da moderação do conteúdo, não da
 * idade ou do assurance do proprietário.
 */
export function isCurrentPublicMediaProjectionExposure(
  data: Record<string, unknown> | null | undefined,
  _nowMs: number,
  allowedVisibilities: readonly string[] = ['PUBLIC']
): boolean {
  if (!data) return false;

  const visibility = normalizedUpper(data['visibility']);
  const allowed = new Set(
    allowedVisibilities.map((value) => normalizedUpper(value))
  );

  return allowed.has(visibility)
    && normalizedUpper(data['moderationStatus']) === 'APPROVED';
}

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
