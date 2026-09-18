// functions/src/community/community-settings.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY SETTINGS AUTHORIZATION POLICY
// -----------------------------------------------------------------------------

import type { CommunityViewerRole } from './community-preview.model';

export type CommunitySettingsPolicyDenialReason =
  | 'source_unsupported'
  | 'community_unavailable'
  | 'manager_required'
  | 'owner_required_for_capacity';

export interface CommunitySettingsPolicyInput {
  sourceType: 'community' | 'venue' | null;
  communityStatus: string | null;
  moderationState: string | null;
  actorStatus: string | null;
  actorRole: CommunityViewerRole | null;
  capacityChanged: boolean;
}

export interface CommunitySettingsPolicyDecision {
  allowed: boolean;
  denialReason: CommunitySettingsPolicyDenialReason | null;
}

export type CommunitySettingsIdempotencyReplayDecision =
  | {
    readonly state: 'valid';
    readonly changedFields: string[];
    readonly generatedAt: number;
  }
  | { readonly state: 'conflict' }
  | { readonly state: 'invalid' };

export interface CommunitySettingsIdempotencyReplayInput {
  readonly rawRequest: unknown;
  readonly expectedActorUid: string;
  readonly expectedCommunityId: string;
}

const COMMUNITY_SETTINGS_CHANGED_FIELDS = new Set<string>([
  'name',
  'description',
  'rules',
  'joinPolicy',
  'membersCanInvite',
  'memberLimit',
  'tagIds',
]);

export function evaluateCommunitySettingsUpdate(
  input: CommunitySettingsPolicyInput
): CommunitySettingsPolicyDecision {
  if (input.sourceType !== 'community') {
    return { allowed: false, denialReason: 'source_unsupported' };
  }

  if (
    (input.communityStatus !== 'active' && input.communityStatus !== 'paused')
    || input.moderationState !== 'active'
  ) {
    return { allowed: false, denialReason: 'community_unavailable' };
  }

  if (
    input.actorStatus !== 'active'
    || (input.actorRole !== 'owner' && input.actorRole !== 'admin')
  ) {
    return { allowed: false, denialReason: 'manager_required' };
  }

  if (input.capacityChanged && input.actorRole !== 'owner') {
    return { allowed: false, denialReason: 'owner_required_for_capacity' };
  }

  return { allowed: true, denialReason: null };
}


export function evaluateCommunitySettingsIdempotencyReplay(
  input: Readonly<CommunitySettingsIdempotencyReplayInput>
): CommunitySettingsIdempotencyReplayDecision {
  if (
    input.rawRequest === null
    || typeof input.rawRequest !== 'object'
    || Array.isArray(input.rawRequest)
  ) {
    return { state: 'invalid' };
  }

  const request = input.rawRequest as Record<string, unknown>;

  if (
    request['actorUid'] !== input.expectedActorUid
    || request['communityId'] !== input.expectedCommunityId
  ) {
    return { state: 'conflict' };
  }

  if (request['status'] !== 'completed') {
    return { state: 'invalid' };
  }

  const generatedAt = request['generatedAt'];
  if (
    typeof generatedAt !== 'number'
    || !Number.isSafeInteger(generatedAt)
    || generatedAt <= 0
  ) {
    return { state: 'invalid' };
  }

  const rawChangedFields = request['changedFields'];
  if (!Array.isArray(rawChangedFields)) {
    return { state: 'invalid' };
  }

  const changedFields: string[] = [];
  const seen = new Set<string>();

  for (const field of rawChangedFields) {
    if (
      typeof field !== 'string'
      || !COMMUNITY_SETTINGS_CHANGED_FIELDS.has(field)
      || seen.has(field)
    ) {
      return { state: 'invalid' };
    }

    seen.add(field);
    changedFields.push(field);
  }

  return { state: 'valid', changedFields, generatedAt };
}
