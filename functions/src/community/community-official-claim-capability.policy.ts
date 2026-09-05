// functions/src/community/community-official-claim-capability.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM CAPABILITY
// -----------------------------------------------------------------------------
// Resolve somente alvos cuja autoridade já pode ser comprovada por fonte
// canônica backend-only. O cliente recebe alvo, rótulo e papel, nunca grant,
// organização patrocinadora ou referência de evidência.
// -----------------------------------------------------------------------------

import {
  resolveCanonicalResourceAuthority,
} from '../authority/canonical-resource-authority.resolver';
import {
  evaluateOfficialSpaceCreationGrant,
} from './community-official-space.policy';

export const MAX_COMMUNITY_OFFICIAL_CLAIM_CANDIDATES = 12;

export type CommunityOfficialClaimCapabilityReason =
  | 'eligible'
  | 'verification_required'
  | 'verification_inactive'
  | 'no_eligible_target'
  | 'community_already_official';

export interface CommunityOfficialClaimCapabilityCandidate {
  readonly target: {
    readonly type: 'venue';
    readonly id: string;
  };
  readonly label: string;
  readonly authorityRole: 'owner' | 'manager';
}

export interface CommunityOfficialClaimCapabilityDecision {
  readonly canSubmit: boolean;
  readonly reason: CommunityOfficialClaimCapabilityReason;
  readonly candidates: readonly CommunityOfficialClaimCapabilityCandidate[];
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanLabel(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, 80);
}

export function resolveCommunityOfficialClaimCapability(input: {
  readonly actorUid: string;
  readonly rawGrant: unknown;
  readonly rawVenues: readonly Readonly<Record<string, unknown>>[];
  readonly communityAlreadyOfficial: boolean;
  readonly now?: number;
}): Readonly<CommunityOfficialClaimCapabilityDecision> {
  if (input.communityAlreadyOfficial) {
    return Object.freeze({
      canSubmit: false,
      reason: 'community_already_official',
      candidates: Object.freeze([]),
    });
  }

  const actorUid = cleanId(input.actorUid);
  if (!actorUid) {
    return Object.freeze({
      canSubmit: false,
      reason: 'verification_required',
      candidates: Object.freeze([]),
    });
  }

  const grant = evaluateOfficialSpaceCreationGrant({
    actorUid,
    // Claim nunca herda bypass administrativo: precisa de autoridade comercial.
    actorUserRole: null,
    rawGrant: input.rawGrant,
    now: input.now,
  });

  if (!grant.allowed) {
    return Object.freeze({
      canSubmit: false,
      reason: grant.denialReason === 'grant_inactive'
        ? 'verification_inactive'
        : 'verification_required',
      candidates: Object.freeze([]),
    });
  }

  const unique = new Map<string, CommunityOfficialClaimCapabilityCandidate>();

  for (const rawVenue of input.rawVenues) {
    if (unique.size >= MAX_COMMUNITY_OFFICIAL_CLAIM_CANDIDATES) break;

    const venueId = cleanId(rawVenue['id']);
    if (!venueId) continue;

    // Um alvo já ligado oficialmente não deve reaparecer como reivindicável.
    // Este campo é apenas uma projeção de disponibilidade; a confirmação final
    // do singleton continua pertencendo à associação canônica no submit.
    if (cleanId(rawVenue['officialAssociationKey'])) continue;

    const authority = resolveCanonicalResourceAuthority({
      actorUid,
      targetType: 'venue',
      targetId: venueId,
      rawCommercialGrant: input.rawGrant,
      rawTarget: rawVenue,
      now: input.now,
    });

    if (!authority.allowed || !authority.authorityRole) continue;

    unique.set(venueId, Object.freeze({
      target: Object.freeze({ type: 'venue' as const, id: venueId }),
      label: cleanLabel(rawVenue['name'], 'Local sem nome'),
      authorityRole: authority.authorityRole,
    }));
  }

  const candidates = Object.freeze([...unique.values()]);

  return Object.freeze({
    canSubmit: candidates.length > 0,
    reason: candidates.length > 0 ? 'eligible' : 'no_eligible_target',
    candidates,
  });
}
