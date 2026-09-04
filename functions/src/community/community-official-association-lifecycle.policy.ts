// functions/src/community/community-official-association-lifecycle.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL ASSOCIATION LIFECYCLE POLICY
// -----------------------------------------------------------------------------
// Centraliza a revogação de vínculos oficiais quando a Comunidade entra em
// estado terminal. A associação é preservada para auditoria e apenas muda de
// `verified` para `revoked`; nenhuma evidência privada é projetada para a UI.
// -----------------------------------------------------------------------------

import {
  normalizeCommunityOfficialAssociationKey,
  sanitizeCommunityOfficialAssociationPublicProjection,
  type CommunityOfficialAssociationPublicProjection,
} from './community-official-association.model';

export type CommunityOfficialAssociationRevocationReason =
  | 'community_archived'
  | 'community_scheduled_for_deletion';

export interface CommunityOfficialAssociationTerminalTransition {
  readonly associationKey: string;
  readonly reason: CommunityOfficialAssociationRevocationReason;
}

export type CommunityOfficialAssociationRevocationDecision =
  | { readonly state: 'missing' }
  | { readonly state: 'already_revoked' }
  | { readonly state: 'inconsistent' }
  | {
    readonly state: 'revoke';
    readonly target: CommunityOfficialAssociationPublicProjection['target'];
    readonly patch: Readonly<Record<string, unknown>>;
  };

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function resolveTerminalReason(
  status: unknown
): CommunityOfficialAssociationRevocationReason | null {
  if (status === 'archived') return 'community_archived';
  if (status === 'scheduled_for_deletion') {
    return 'community_scheduled_for_deletion';
  }
  return null;
}

/**
 * Retorna transição apenas quando o estado terminal ou a chave oficial mudou.
 * Isso evita uma leitura adicional da associação em updates irrelevantes de uma
 * Comunidade que já está arquivada.
 */
export function resolveCommunityOfficialAssociationTerminalTransition(
  rawBeforeCommunity: unknown,
  rawAfterCommunity: unknown
): CommunityOfficialAssociationTerminalTransition | null {
  const before = (rawBeforeCommunity ?? {}) as Record<string, unknown>;
  const after = (rawAfterCommunity ?? {}) as Record<string, unknown>;
  const associationKey = normalizeCommunityOfficialAssociationKey(
    after['officialAssociationKey']
  );
  const reason = resolveTerminalReason(after['status']);

  if (!associationKey || !reason) return null;

  const previousAssociationKey = normalizeCommunityOfficialAssociationKey(
    before['officialAssociationKey']
  );
  const previousReason = resolveTerminalReason(before['status']);

  if (
    previousAssociationKey === associationKey
    && previousReason === reason
  ) {
    return null;
  }

  return { associationKey, reason };
}

/**
 * Valida que o documento apontado pela Comunidade realmente representa aquele
 * mesmo vínculo antes de revogá-lo. Inconsistências falham fechadas para impedir
 * a revogação acidental da associação de outra entidade.
 */
export function evaluateCommunityOfficialAssociationRevocation(input: {
  readonly rawAssociation: unknown;
  readonly expectedAssociationKey: string;
  readonly expectedCommunityId: string;
  readonly revokedAt: number;
}): CommunityOfficialAssociationRevocationDecision {
  if (input.rawAssociation === null || input.rawAssociation === undefined) {
    return { state: 'missing' };
  }

  const association = input.rawAssociation as Record<string, unknown>;
  const expectedAssociationKey = normalizeCommunityOfficialAssociationKey(
    input.expectedAssociationKey
  );
  const expectedCommunityId = normalizeSafeId(input.expectedCommunityId);
  const associationKey = normalizeCommunityOfficialAssociationKey(
    association['associationKey']
  );
  const communityId = normalizeSafeId(association['communityId']);

  if (
    !expectedAssociationKey
    || !expectedCommunityId
    || associationKey !== expectedAssociationKey
    || communityId !== expectedCommunityId
  ) {
    return { state: 'inconsistent' };
  }

  if (association['status'] === 'revoked') {
    return { state: 'already_revoked' };
  }

  if (association['status'] !== 'verified') {
    return { state: 'inconsistent' };
  }

  const publicProjection =
    sanitizeCommunityOfficialAssociationPublicProjection(association);
  const revokedAt = Number(input.revokedAt);

  if (
    !publicProjection
    || !Number.isFinite(revokedAt)
    || revokedAt <= 0
  ) {
    return { state: 'inconsistent' };
  }

  return {
    state: 'revoke',
    target: publicProjection.target,
    patch: Object.freeze({
      status: 'revoked',
      revokedAt: Math.trunc(revokedAt),
      updatedAt: Math.trunc(revokedAt),
    }),
  };
}
