// functions/src/community/official-communities.query.ts
// -----------------------------------------------------------------------------
// OFFICIAL COMMUNITIES PUBLIC QUERY
// -----------------------------------------------------------------------------
// Única leitura backend para superfícies que precisam listar Comunidades
// oficialmente vinculadas a uma entidade canônica. A associação privada é a
// fonte de verdade; o discovery é somente a projeção pública usada para montar
// o card depois que o vínculo canônico atual foi confirmado.
// -----------------------------------------------------------------------------

import { db } from '../firebaseApp';
import {
  buildCommunityOfficialAssociationKey,
  normalizeCommunityOfficialAssociationKey,
  sanitizeCommunityOfficialAssociationPublicProjection,
  type CommunityOfficialTarget,
} from './community-official-association.model';
import {
  CommunityDiscoveryPageResponse,
  CommunityPreviewCard,
  sanitizeCommunityDiscoveryProjection,
} from './community-preview.model';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export interface CanonicalOfficialCommunityReference {
  readonly associationKey: string;
  readonly communityId: string;
  readonly target: CommunityOfficialTarget;
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Valida uma associação por seus próprios campos canônicos, sem confiar em
 * projeções gravadas na Comunidade ou no alvo. Somente vínculo verificado,
 * vigente e estruturalmente consistente produz referência utilizável.
 */
export function resolveCanonicalOfficialCommunityReferenceFromAssociation(
  rawAssociation: unknown
): CanonicalOfficialCommunityReference | null {
  if (rawAssociation === null || rawAssociation === undefined) return null;

  const association = rawAssociation as Record<string, unknown>;
  const associationKey = normalizeCommunityOfficialAssociationKey(
    association['associationKey']
  );
  const communityId = normalizeSafeId(association['communityId']);
  const publicAssociation =
    sanitizeCommunityOfficialAssociationPublicProjection(association);

  if (!associationKey || !communityId || !publicAssociation) return null;

  const expectedAssociationKey = buildCommunityOfficialAssociationKey(
    publicAssociation.target
  );
  if (!expectedAssociationKey || associationKey !== expectedAssociationKey) {
    return null;
  }

  return Object.freeze({
    associationKey,
    communityId,
    target: publicAssociation.target,
  });
}

export function resolveCanonicalOfficialCommunityReference(
  target: Readonly<CommunityOfficialTarget>,
  rawAssociation: unknown
): CanonicalOfficialCommunityReference | null {
  const expectedAssociationKey = buildCommunityOfficialAssociationKey(target);
  if (!expectedAssociationKey) return null;

  const reference = resolveCanonicalOfficialCommunityReferenceFromAssociation(
    rawAssociation
  );

  if (
    !reference
    || reference.associationKey !== expectedAssociationKey
    || reference.target.type !== target.type
    || reference.target.id !== target.id
  ) {
    return null;
  }

  return reference;
}

export function resolveOfficialCommunityCardForCanonicalReference(
  reference: Readonly<CanonicalOfficialCommunityReference>,
  rawDiscoveryProjection: unknown
): CommunityPreviewCard | null {
  const item = sanitizeCommunityDiscoveryProjection(
    reference.communityId,
    rawDiscoveryProjection
  );
  const official = item?.officialAssociation;

  if (
    !item
    || official?.verified !== true
    || official.target.type !== reference.target.type
    || official.target.id !== reference.target.id
  ) {
    return null;
  }

  return item;
}

function buildEmptyResponse(generatedAt: number): CommunityDiscoveryPageResponse {
  return {
    items: [],
    nextCursor: null,
    generatedAt,
  };
}

export async function loadOfficialCommunitiesForTarget(
  target: Readonly<CommunityOfficialTarget>,
  limit: number
): Promise<CommunityDiscoveryPageResponse> {
  const generatedAt = Date.now();
  const associationKey = buildCommunityOfficialAssociationKey(target);
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 12);

  if (!associationKey || normalizedLimit < 1) {
    return buildEmptyResponse(generatedAt);
  }

  const item = await db.runTransaction(async (transaction) => {
    const associationRef = db
      .collection('community_official_associations')
      .doc(associationKey);
    const associationSnapshot = await transaction.get(associationRef);

    if (!associationSnapshot.exists) return null;

    const reference = resolveCanonicalOfficialCommunityReference(
      target,
      associationSnapshot.data()
    );
    if (!reference) return null;

    const projectionRef = db
      .collection('community_discovery_index')
      .doc(reference.communityId);
    const projectionSnapshot = await transaction.get(projectionRef);

    if (!projectionSnapshot.exists) return null;

    return resolveOfficialCommunityCardForCanonicalReference(
      reference,
      projectionSnapshot.data()
    );
  });

  if (!item) {
    return buildEmptyResponse(generatedAt);
  }

  // A chave determinística por alvo torna o vínculo oficial singleton. O limite
  // permanece no contrato por compatibilidade e futura evolução sem quebrar UI.
  return {
    items: normalizedLimit > 0 ? [item] : [],
    nextCursor: null,
    generatedAt,
  };
}
