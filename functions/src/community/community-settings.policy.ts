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
