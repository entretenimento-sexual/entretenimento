// functions/src/media/application/official-media-context.policy.ts
// -----------------------------------------------------------------------------
// OFFICIAL MEDIA CONTEXT
// -----------------------------------------------------------------------------
// Projeção derivada para UI. Nunca é autoridade e nunca é editável pelo dono da
// mídia. Só existe quando identidade do perfil + associação oficial + target
// continuam válidos nas respectivas fontes canônicas.
// -----------------------------------------------------------------------------

import {
  normalizeCanonicalAuthorityResourceId,
} from '../../authority/canonical-resource-authority.model';
import {
  sanitizeCommunityOfficialAssociationPublicProjection,
} from '../../community/community-official-association.model';
import { evaluateProfileKyc } from '../../identity/profile-kyc.policy';

export interface OfficialMediaContextProjection {
  readonly identity: {
    readonly verified: true;
    readonly type: 'profile';
  };
  readonly association: {
    readonly verified: true;
  };
  readonly target: {
    readonly type: 'profile';
    readonly id: string;
  };
}

type CanonicalUserLike = {
  profileId?: unknown;
};

export function deriveOfficialMediaContext(input: {
  readonly ownerUid: string;
  readonly rawUser: unknown;
  readonly rawProfileKyc: unknown;
  readonly rawAssociation: unknown;
  readonly nowMs?: number;
}): OfficialMediaContextProjection | null {
  const ownerUid = normalizeCanonicalAuthorityResourceId(input.ownerUid);
  if (!ownerUid || !input.rawUser || typeof input.rawUser !== 'object') {
    return null;
  }

  const user = input.rawUser as CanonicalUserLike;
  const profileId = normalizeCanonicalAuthorityResourceId(user.profileId);
  if (!profileId) return null;

  const identity = evaluateProfileKyc({
    actorUid: ownerUid,
    profileId,
    rawKyc: input.rawProfileKyc,
    now: input.nowMs,
  });
  if (!identity.allowed || identity.profileId !== profileId) {
    return null;
  }

  const association =
    sanitizeCommunityOfficialAssociationPublicProjection(
      input.rawAssociation
    );

  if (
    !association
    || association.target.type !== 'profile'
    || association.target.id !== profileId
  ) {
    return null;
  }

  return Object.freeze({
    identity: Object.freeze({
      verified: true as const,
      type: 'profile' as const,
    }),
    association: Object.freeze({
      verified: true as const,
    }),
    target: Object.freeze({
      type: 'profile' as const,
      id: profileId,
    }),
  });
}

export function officialMediaContextMatches(
  raw: unknown,
  expected: OfficialMediaContextProjection | null
): boolean {
  if (!expected) {
    return raw === null || raw === undefined;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const source = raw as Record<string, unknown>;
  const identity = (source['identity'] ?? {}) as Record<string, unknown>;
  const association = (source['association'] ?? {}) as Record<string, unknown>;
  const target = (source['target'] ?? {}) as Record<string, unknown>;

  return identity['verified'] === true
    && identity['type'] === 'profile'
    && association['verified'] === true
    && target['type'] === 'profile'
    && target['id'] === expected.target.id;
}
