// src/app/community/data-access/community-official-claim-capability.model.ts
import type { CommunityOfficialTarget } from './community-official-target.policy';

export type CommunityOfficialClaimCapabilityReason =
  | 'eligible'
  | 'verification_required'
  | 'verification_inactive'
  | 'no_eligible_target'
  | 'community_already_official';

export type CommunityOfficialClaimCapabilityTarget =
  CommunityOfficialTarget & { readonly type: 'organization' | 'venue' };

export interface CommunityOfficialClaimCapabilityCandidate {
  readonly target: CommunityOfficialClaimCapabilityTarget;
  readonly label: string;
  readonly authorityRole: 'owner' | 'authorized_representative' | 'manager';
}

export interface CommunityOfficialClaimCapabilityResponse {
  readonly canSubmit: boolean;
  readonly reason: CommunityOfficialClaimCapabilityReason;
  readonly candidates: readonly CommunityOfficialClaimCapabilityCandidate[];
  readonly generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanEpoch(value: unknown): number | null {
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function cleanReason(value: unknown): CommunityOfficialClaimCapabilityReason | null {
  return value === 'eligible'
    || value === 'verification_required'
    || value === 'verification_inactive'
    || value === 'no_eligible_target'
    || value === 'community_already_official'
    ? value
    : null;
}

function cleanTargetType(
  value: unknown
): CommunityOfficialClaimCapabilityTarget['type'] | null {
  return value === 'organization' || value === 'venue' ? value : null;
}

function cleanAuthorityRole(
  value: unknown
): CommunityOfficialClaimCapabilityCandidate['authorityRole'] | null {
  return value === 'owner'
    || value === 'authorized_representative'
    || value === 'manager'
    ? value
    : null;
}

export function buildCommunityOfficialClaimCapabilityCandidateKey(
  candidate: Pick<CommunityOfficialClaimCapabilityCandidate, 'target'>
): string {
  return `${candidate.target.type}:${candidate.target.id}`;
}

export function normalizeCommunityOfficialClaimCapabilityResponse(
  raw: unknown
): CommunityOfficialClaimCapabilityResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const reason = cleanReason(source['reason']);
  const generatedAt = cleanEpoch(source['generatedAt']);
  if (
    typeof source['canSubmit'] !== 'boolean'
    || !reason
    || !generatedAt
    || !Array.isArray(source['candidates'])
    || source['candidates'].length > 12
  ) {
    return null;
  }

  const candidates: CommunityOfficialClaimCapabilityCandidate[] = [];
  const keys = new Set<string>();
  for (const rawCandidate of source['candidates']) {
    const candidate = (rawCandidate ?? {}) as Record<string, unknown>;
    const target = (candidate['target'] ?? {}) as Record<string, unknown>;
    const type = cleanTargetType(target['type']);
    const id = cleanId(target['id']);
    const label = String(candidate['label'] ?? '').replace(/\s+/g, ' ').trim();
    const authorityRole = cleanAuthorityRole(candidate['authorityRole']);

    if (!type || !id || !label || label.length > 80 || !authorityRole) {
      return null;
    }

    const normalizedCandidate: CommunityOfficialClaimCapabilityCandidate = {
      target: { type, id },
      label,
      authorityRole,
    };
    const key = buildCommunityOfficialClaimCapabilityCandidateKey(
      normalizedCandidate
    );
    if (keys.has(key)) return null;

    keys.add(key);
    candidates.push(normalizedCandidate);
  }

  if (
    source['canSubmit'] !== (candidates.length > 0)
    || (source['canSubmit'] && reason !== 'eligible')
    || (!source['canSubmit'] && reason === 'eligible')
  ) {
    return null;
  }

  return {
    canSubmit: source['canSubmit'],
    reason,
    candidates,
    generatedAt,
  };
}
