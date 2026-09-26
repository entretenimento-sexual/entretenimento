export type AvailableMediaPublicationVisibility =
  | 'FRIENDS'
  | 'PUBLIC';

export type ReservedPaidMediaPublicationVisibility =
  | 'SUBSCRIBERS'
  | 'PREMIUM';

export type AvailablePhotoCommentsPolicy =
  | 'OFF'
  | 'FRIENDS'
  | 'EVERYONE';

export type ReservedPaidPhotoCommentsPolicy = 'SUBSCRIBERS';

export type MediaPublicationContractDecision<T extends string> =
  | {
    readonly status: 'AVAILABLE';
    readonly value: T;
  }
  | {
    readonly status: 'UNAVAILABLE_ENTITLEMENT';
    readonly requested:
      | ReservedPaidMediaPublicationVisibility
      | ReservedPaidPhotoCommentsPolicy;
  }
  | {
    readonly status: 'INVALID';
  };

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * SUBSCRIBERS/PREMIUM são nomes reservados de contrato, não capacidades.
 *
 * Enquanto a autorização de audiência paga não validar entitlement do viewer,
 * owner, produto e janela de acesso no backend, esses estados não podem ser
 * persistidos como se fossem funcionais. Documentos legados continuam sendo
 * lidos fail-closed pelas fronteiras de consumo.
 */
export function resolveMediaPublicationVisibility(
  value: unknown
): MediaPublicationContractDecision<AvailableMediaPublicationVisibility> {
  const normalized = normalize(value);

  if (!normalized || normalized === 'PUBLIC') {
    return { status: 'AVAILABLE', value: 'PUBLIC' };
  }

  if (normalized === 'FRIENDS') {
    return { status: 'AVAILABLE', value: 'FRIENDS' };
  }

  if (normalized === 'SUBSCRIBERS' || normalized === 'PREMIUM') {
    return {
      status: 'UNAVAILABLE_ENTITLEMENT',
      requested: normalized,
    };
  }

  return { status: 'INVALID' };
}

export function resolvePhotoCommentsPolicy(
  value: unknown,
  commentsEnabled: boolean
): MediaPublicationContractDecision<AvailablePhotoCommentsPolicy> {
  if (!commentsEnabled) {
    return { status: 'AVAILABLE', value: 'OFF' };
  }

  const normalized = normalize(value);

  if (!normalized || normalized === 'EVERYONE') {
    return { status: 'AVAILABLE', value: 'EVERYONE' };
  }

  if (normalized === 'FRIENDS') {
    return { status: 'AVAILABLE', value: 'FRIENDS' };
  }

  if (normalized === 'SUBSCRIBERS') {
    return {
      status: 'UNAVAILABLE_ENTITLEMENT',
      requested: 'SUBSCRIBERS',
    };
  }

  return { status: 'INVALID' };
}
