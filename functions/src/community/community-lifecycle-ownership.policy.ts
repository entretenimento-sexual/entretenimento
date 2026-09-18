// functions/src/community/community-lifecycle-ownership.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY LIFECYCLE OWNERSHIP
// -----------------------------------------------------------------------------
// Resolve o ponteiro canônico de ownership somente quando o lifecycle possui
// prova transacional de que não há memberships ativas e pretende executar uma
// transição destrutiva baseada em vazio. Estado desconhecido permanece fail
// closed; o scheduler nunca "adivinha" que um owner residual pode ser removido.
// -----------------------------------------------------------------------------

import {
  classifyCommunityCanonicalOwnerPointer,
} from './community-canonical-owner.policy';
import {
  classifyExistingCommunityMembershipState,
} from './community-membership-state.policy';
import type {
  CommunityLifecycleDecision,
  CommunityLifecycleMembershipOccupancy,
} from './community-lifecycle.policy';

export type CommunityLifecycleOwnershipResolution =
  | Readonly<{ state: 'not_required'; ownerUid: null }>
  | Readonly<{ state: 'already_released'; ownerUid: null }>
  | Readonly<{ state: 'needs_owner_membership_read'; ownerUid: string }>
  | Readonly<{ state: 'release'; ownerUid: string }>
  | Readonly<{
    state: 'inconsistent';
    ownerUid: string | null;
    reason:
      | 'owner_pointer_invalid'
      | 'owner_membership_invalid'
      | 'owner_membership_active';
  }>;

export interface CommunityLifecycleOwnerMembershipRead {
  readonly exists: boolean;
  readonly data: unknown;
}

function requiresEmptyOwnershipResolution(
  decision: Readonly<CommunityLifecycleDecision>,
  membershipOccupancy: CommunityLifecycleMembershipOccupancy
): boolean {
  if (!decision.changed || membershipOccupancy !== 'empty') return false;

  return decision.reason === 'empty_and_inactive'
    || decision.reason === 'empty_archive_expired'
    || decision.reason === 'orphaned_content_archive_expired';
}

export function resolveCommunityLifecycleOwnership(
  rawCommunity: unknown,
  decision: Readonly<CommunityLifecycleDecision>,
  membershipOccupancy: CommunityLifecycleMembershipOccupancy,
  ownerMembershipRead: Readonly<CommunityLifecycleOwnerMembershipRead> | null
    = null
): CommunityLifecycleOwnershipResolution {
  if (!requiresEmptyOwnershipResolution(decision, membershipOccupancy)) {
    return { state: 'not_required', ownerUid: null };
  }

  const ownerPointer = classifyCommunityCanonicalOwnerPointer(rawCommunity);

  if (ownerPointer.kind === 'absent') {
    return { state: 'already_released', ownerUid: null };
  }

  if (ownerPointer.kind === 'invalid') {
    return {
      state: 'inconsistent',
      ownerUid: null,
      reason: 'owner_pointer_invalid',
    };
  }

  if (!ownerMembershipRead) {
    return {
      state: 'needs_owner_membership_read',
      ownerUid: ownerPointer.uid,
    };
  }

  const membershipState = classifyExistingCommunityMembershipState(
    ownerMembershipRead.exists,
    (ownerMembershipRead.data as Record<string, unknown> | null)?.['status']
  );

  if (membershipState.kind === 'invalid') {
    return {
      state: 'inconsistent',
      ownerUid: ownerPointer.uid,
      reason: 'owner_membership_invalid',
    };
  }

  if (
    membershipState.kind === 'valid'
    && membershipState.status === 'active'
  ) {
    return {
      state: 'inconsistent',
      ownerUid: ownerPointer.uid,
      reason: 'owner_membership_active',
    };
  }

  return { state: 'release', ownerUid: ownerPointer.uid };
}
