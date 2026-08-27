// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL SPACE POLICY
// -----------------------------------------------------------------------------
// O cadastro comercial é liberado somente por uma concessão backend-only
// vinculada ao responsável verificado. A organização, e não o plano pessoal,
// determina a quantidade de Espaços Oficiais que podem ser criados.
// -----------------------------------------------------------------------------

import { OFFICIAL_SPACE_MEMBER_LIMIT } from './community-capacity.policy';

export const OFFICIAL_SPACE_CREATION_POLICY_VERSION = 1;
export const MAX_OFFICIAL_SPACES_PER_GRANT = 20;

export interface OfficialSpaceCreationDecision {
  allowed: boolean;
  organizationId: string | null;
  maxOfficialSpaces: number | null;
  memberLimit: typeof OFFICIAL_SPACE_MEMBER_LIMIT;
  denialReason: 'verification_required' | 'grant_inactive' | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function finiteEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function normalizeMaximum(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_OFFICIAL_SPACES_PER_GRANT
    ? value
    : null;
}

export function evaluateOfficialSpaceCreationGrant(input: {
  actorUid: string;
  actorUserRole: unknown;
  rawGrant: unknown;
  now?: number;
}): Readonly<OfficialSpaceCreationDecision> {
  const now = input.now ?? Date.now();

  if (input.actorUserRole === 'admin') {
    return {
      allowed: true,
      organizationId: 'platform-administration',
      maxOfficialSpaces: null,
      memberLimit: OFFICIAL_SPACE_MEMBER_LIMIT,
      denialReason: null,
    };
  }

  const grant = (input.rawGrant ?? {}) as Record<string, unknown>;
  const organizationId = String(grant['organizationId'] ?? '').trim();
  const startsAt = finiteEpoch(grant['startsAt']);
  const endsAt = grant['endsAt'] === null
    ? null
    : finiteEpoch(grant['endsAt']);
  const maxOfficialSpaces = normalizeMaximum(grant['maxOfficialSpaces']);
  const structurallyVerified =
    grant['holderUid'] === input.actorUid
    && grant['scope'] === 'official_space_creation'
    && grant['verificationStatus'] === 'verified'
    && grant['policyVersion'] === OFFICIAL_SPACE_CREATION_POLICY_VERSION
    && SAFE_ID_PATTERN.test(organizationId)
    && maxOfficialSpaces !== null;

  if (!structurallyVerified) {
    return {
      allowed: false,
      organizationId: null,
      maxOfficialSpaces: null,
      memberLimit: OFFICIAL_SPACE_MEMBER_LIMIT,
      denialReason: 'verification_required',
    };
  }

  const active = grant['active'] === true
    && startsAt !== null
    && startsAt <= now
    && (endsAt === null || endsAt > now);

  return active
    ? {
      allowed: true,
      organizationId,
      maxOfficialSpaces,
      memberLimit: OFFICIAL_SPACE_MEMBER_LIMIT,
      denialReason: null,
    }
    : {
      allowed: false,
      organizationId,
      maxOfficialSpaces,
      memberLimit: OFFICIAL_SPACE_MEMBER_LIMIT,
      denialReason: 'grant_inactive',
    };
}
