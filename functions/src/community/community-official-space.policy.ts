// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL SPACE POLICY
// -----------------------------------------------------------------------------
// O cadastro comercial é liberado somente por uma concessão backend-only
// vinculada ao responsável verificado. A organização, e não o plano pessoal,
// determina a quantidade de Espaços Oficiais que podem ser criados.
// -----------------------------------------------------------------------------

import {
  evaluateVerifiedCommercialAuthority,
} from '../authority/verified-commercial-authority.policy';
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

function normalizeMaximum(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_OFFICIAL_SPACES_PER_GRANT
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function evaluateOfficialSpaceCreationGrant(input: {
  actorUid: string;
  actorUserRole: unknown;
  rawGrant: unknown;
  now?: number;
}): Readonly<OfficialSpaceCreationDecision> {
  if (input.actorUserRole === 'admin') {
    return {
      allowed: true,
      organizationId: 'platform-administration',
      maxOfficialSpaces: null,
      memberLimit: OFFICIAL_SPACE_MEMBER_LIMIT,
      denialReason: null,
    };
  }

  const commercialAuthority = evaluateVerifiedCommercialAuthority({
    actorUid: input.actorUid,
    rawGrant: input.rawGrant,
    now: input.now,
  });

  if (!commercialAuthority.allowed) {
    return {
      allowed: false,
      organizationId: commercialAuthority.organizationId,
      maxOfficialSpaces: null,
      memberLimit: OFFICIAL_SPACE_MEMBER_LIMIT,
      denialReason: commercialAuthority.denialReason === 'authority_inactive'
        ? 'grant_inactive'
        : 'verification_required',
    };
  }

  const grant = isRecord(input.rawGrant) ? input.rawGrant : {};
  const maxOfficialSpaces = normalizeMaximum(grant['maxOfficialSpaces']);
  const hasOfficialSpaceCapability =
    grant['scope'] === 'official_space_creation'
    && grant['policyVersion'] === OFFICIAL_SPACE_CREATION_POLICY_VERSION
    && maxOfficialSpaces !== null;

  if (!hasOfficialSpaceCapability) {
    return {
      allowed: false,
      organizationId: commercialAuthority.organizationId,
      maxOfficialSpaces: null,
      memberLimit: OFFICIAL_SPACE_MEMBER_LIMIT,
      denialReason: 'verification_required',
    };
  }

  return {
    allowed: true,
    organizationId: commercialAuthority.organizationId,
    maxOfficialSpaces,
    memberLimit: OFFICIAL_SPACE_MEMBER_LIMIT,
    denialReason: null,
  };
}
