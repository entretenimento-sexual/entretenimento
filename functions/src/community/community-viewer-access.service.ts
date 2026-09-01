// functions/src/community/community-viewer-access.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY VIEWER ACCESS
// -----------------------------------------------------------------------------
// Centraliza comunidade, membership e entitlement. A UI nunca concede acesso;
// handlers usam este contexto antes de devolver metadados ou mural.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../firebaseApp';
import {
  resolveCommunityMemberLimitCapabilityOptionsForCeiling,
} from './community-capacity.policy';
import { getCommunityCapacityForOwner } from './community-capacity.service';
import {
  isCommunityMemberActivityEnabledStatus,
  isCommunityMembershipManagementEnabledStatus,
} from './community-lifecycle.policy';
import { canSendCommunityInvite } from './community-invite.policy';
import { resolveCommunityMembersCanInvite } from './community-invite.shared';
import {
  CommunityMembershipLeaveCommunityStatus,
  CommunityMembershipStatus,
  evaluateCommunityMembershipLeave,
} from './community-membership-request.policy';
import {
  normalizeCommunityOfficialAssociationKey,
  sanitizeCommunityOfficialAssociationPublicProjection,
} from './community-official-association.model';
import {
  CommunityPreviewCard,
  CommunityPreviewLifecycleStatus,
  CommunityPreviewResponse,
  CommunityViewerMode,
  CommunityViewerRole,
  resolveCommunityViewerMode,
  sanitizeCommunityDocument,
  sanitizeCommunityPreviewDetails,
} from './community-preview.model';
import {
  CommunityEditableSettings,
  sanitizeCommunityEditableSettings,
} from './community-settings.model';
import { evaluateCommunitySettingsUpdate } from './community-settings.policy';

export interface CommunityViewerContext {
  community: CommunityPreviewCard;
  rules: string | null;
  lifecycleStatus: CommunityPreviewLifecycleStatus | null;
  viewerMode: CommunityViewerMode;
  viewerRole: CommunityViewerRole | null;
  activeMembership: boolean;
  memberContentAccess: boolean;
  authenticatedPreviewAccess?: boolean;
  operational: boolean;
  memberActivityAllowed: boolean;
  canInteract: boolean;
  canManageMemberships: boolean;
  canInviteCommunityMembers: boolean;
  canManageCommunitySettings: boolean;
  capacity: CommunityPreviewResponse['capacity'];
  settings: CommunityEditableSettings | null;
  canLeaveMembership: boolean;
}

function isManagementRole(role: CommunityViewerRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}

function normalizeMembershipStatus(value: unknown): CommunityMembershipStatus | null {
  return value === 'active'
    || value === 'pending'
    || value === 'blocked'
    || value === 'left'
    ? value
    : null;
}

function normalizeCommunityLeaveStatus(
  value: unknown
): CommunityMembershipLeaveCommunityStatus {
  return value === 'active'
    || value === 'paused'
    || value === 'dormant'
    || value === 'archived'
    || value === 'scheduled_for_deletion'
    ? value
    : null;
}

export async function getCommunityViewerContext(
  uid: string,
  communityId: string
): Promise<CommunityViewerContext> {
  const communityRef = db.collection('communities').doc(communityId);
  const membershipRef = communityRef.collection('members').doc(uid);
  const [communitySnapshot, membershipSnapshot] = await Promise.all([
    communityRef.get(),
    membershipRef.get(),
  ]);

  if (!communitySnapshot.exists) {
    throw new HttpsError('not-found', 'Comunidade não encontrada.');
  }

  const communityRaw = communitySnapshot.data() ?? null;
  const raw = (communityRaw ?? {}) as Record<string, unknown>;
  let community = sanitizeCommunityDocument(communityId, communityRaw);
  const previewDetails = sanitizeCommunityPreviewDetails(communityRaw);
  const membershipRaw = membershipSnapshot.exists
    ? membershipSnapshot.data() ?? {}
    : {};
  const viewer = resolveCommunityViewerMode(membershipRaw);
  const moderation = (raw['moderation'] ?? {}) as Record<string, unknown>;
  const access = (raw['access'] ?? {}) as Record<string, unknown>;
  const moderationActive = moderation['state'] === 'active';
  const operational = raw['status'] === 'active' && moderationActive;
  const memberActivityAllowed =
    moderationActive && isCommunityMemberActivityEnabledStatus(raw['status']);
  const publicPreview =
    operational
    && raw['visibility'] === 'public_preview'
    && access['preview'] === 'authenticated';
  const linkedViewer = viewer.active || viewer.mode === 'pending';

  if (
    viewer.blocked
    || !community
    || !previewDetails
    || (!publicPreview && !linkedViewer)
  ) {
    throw new HttpsError(
      'permission-denied',
      'Você não possui acesso a esta comunidade.'
    );
  }

  const officialAssociationKey = normalizeCommunityOfficialAssociationKey(
    raw['officialAssociationKey']
  );

  if (officialAssociationKey) {
    const associationSnapshot = await db
      .collection('community_official_associations')
      .doc(officialAssociationKey)
      .get();
    const associationRaw = associationSnapshot.exists
      ? associationSnapshot.data() ?? null
      : null;
    const associationSource = (associationRaw ?? {}) as Record<string, unknown>;
    const officialAssociation =
      associationSource['communityId'] === communityId
        ? sanitizeCommunityOfficialAssociationPublicProjection(associationRaw)
        : null;

    if (officialAssociation) {
      community = {
        ...community,
        officialAssociation,
      };
    }
  }

  const memberContentAccess = viewer.active;
  const capacityState = community.source.type === 'community'
    ? await getCommunityCapacityForOwner(communityRaw)
    : null;

  if (community.source.type === 'community' && !capacityState) {
    throw new HttpsError(
      'data-loss',
      'A capacidade da Comunidade está inconsistente.'
    );
  }
  const canManageMemberships =
    viewer.active
    && isManagementRole(viewer.role)
    && moderationActive
    && isCommunityMembershipManagementEnabledStatus(raw['status']);
  const canInviteCommunityMembers =
    operational
    && canSendCommunityInvite(
      normalizeMembershipStatus(membershipRaw['status']),
      viewer.role,
      resolveCommunityMembersCanInvite(communityRaw)
    );
  const settingsDecision = evaluateCommunitySettingsUpdate({
    sourceType: community.source.type,
    communityStatus: typeof raw['status'] === 'string' ? raw['status'] : null,
    moderationState:
      typeof moderation['state'] === 'string' ? moderation['state'] : null,
    actorStatus:
      typeof membershipRaw['status'] === 'string'
        ? membershipRaw['status']
        : null,
    actorRole: viewer.role,
    capacityChanged: false,
  });
  const canManageCommunitySettings = settingsDecision.allowed;
  const settings = canManageCommunitySettings
    ? sanitizeCommunityEditableSettings(communityRaw)
    : null;

  if (canManageCommunitySettings && !settings) {
    throw new HttpsError(
      'data-loss',
      'As configurações atuais da Comunidade estão inconsistentes.'
    );
  }
  const leaveDecision = evaluateCommunityMembershipLeave({
    communityStatus: normalizeCommunityLeaveStatus(raw['status']),
    existingStatus: normalizeMembershipStatus(membershipRaw['status']),
    existingRole: viewer.role,
  });
  const memberLimitOptions = capacityState && viewer.role === 'owner'
    ? resolveCommunityMemberLimitCapabilityOptionsForCeiling(
      capacityState.ownerPlanLimit
    )
    : [];

  return {
    community,
    rules: previewDetails.rules,
    lifecycleStatus: previewDetails.lifecycleStatus,
    viewerMode: viewer.mode,
    viewerRole: viewer.role,
    activeMembership: viewer.active,
    memberContentAccess,
    authenticatedPreviewAccess: publicPreview,
    operational,
    memberActivityAllowed,
    canInteract:
      viewer.active && memberContentAccess && memberActivityAllowed,
    canManageMemberships,
    canInviteCommunityMembers,
    canManageCommunitySettings,
    capacity: capacityState && capacityState.memberCount !== null
      ? {
        configuredLimit: capacityState.configuredLimit,
        effectiveLimit: capacityState.effectiveLimit,
        memberCount: capacityState.memberCount,
        acceptingNewMembers: capacityState.acceptingNewMembers,
        restrictedByOwnerPlan: capacityState.restrictedByOwnerPlan,
        memberLimitOptions,
        allowedMemberLimits: memberLimitOptions
          .filter((option) => option.allowed)
          .map((option) => option.memberLimit),
      }
      : null,
    settings,
    canLeaveMembership: leaveDecision.allowed && !leaveDecision.idempotent,
  };
}
