// src/app/community/data-access/community-membership.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP CLIENT CONTRACT
// -----------------------------------------------------------------------------

export type CommunityMembershipResultStatus = 'active' | 'pending';
export type CommunityMembershipViewerMode = 'member' | 'pending';

export interface CommunityMembershipRequestResponse {
  status: CommunityMembershipResultStatus;
  viewerMode: CommunityMembershipViewerMode;
  canInteract: boolean;
}

export function normalizeCommunityMembershipResponse(
  raw: unknown
): CommunityMembershipRequestResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const status = source['status'];
  const viewerMode = source['viewerMode'];

  if (
    (status !== 'active' && status !== 'pending')
    || (viewerMode !== 'member' && viewerMode !== 'pending')
    || (status === 'active' && viewerMode !== 'member')
    || (status === 'pending' && viewerMode !== 'pending')
  ) {
    return null;
  }

  return {
    status,
    viewerMode,
    canInteract: status === 'active' && source['canInteract'] === true,
  };
}
