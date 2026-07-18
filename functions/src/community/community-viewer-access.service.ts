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
  getActivePlatformSubscriptionEntitlement,
  hasMinimumPlatformRole,
} from '../payments/application/platform-subscription-entitlement.service';
import {
  CommunityPreviewCard,
  CommunityViewerMode,
  resolveCommunityViewerMode,
  sanitizeCommunityDocument,
} from './community-preview.model';

export interface CommunityViewerContext {
  community: CommunityPreviewCard;
  viewerMode: CommunityViewerMode;
  activeMembership: boolean;
  memberContentAccess: boolean;
  operational: boolean;
  canInteract: boolean;
}

async function resolveMemberContentAccess(
  uid: string,
  community: CommunityPreviewCard,
  activeMembership: boolean
): Promise<boolean> {
  if (!activeMembership) return false;

  const requiresEntitlement =
    community.access.requiresActiveSubscription
    || community.access.minimumRole !== null;

  if (!requiresEntitlement) return true;

  const minimumRole = community.access.minimumRole ?? 'basic';
  const entitlement = await getActivePlatformSubscriptionEntitlement(uid);

  return entitlement.active
    && hasMinimumPlatformRole(entitlement.role, minimumRole);
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
  const community = sanitizeCommunityDocument(communityId, communityRaw);
  const viewer = resolveCommunityViewerMode(
    membershipSnapshot.exists ? membershipSnapshot.data() : null
  );
  const raw = (communityRaw ?? {}) as Record<string, unknown>;
  const moderation = (raw['moderation'] ?? {}) as Record<string, unknown>;
  const access = (raw['access'] ?? {}) as Record<string, unknown>;
  const operational =
    raw['status'] === 'active' && moderation['state'] === 'active';
  const publicPreview =
    operational
    && raw['visibility'] === 'public_preview'
    && access['preview'] === 'authenticated';

  if (viewer.blocked || !community || (!publicPreview && !viewer.active)) {
    throw new HttpsError(
      'permission-denied',
      'Você não possui acesso a esta comunidade.'
    );
  }

  const memberContentAccess = await resolveMemberContentAccess(
    uid,
    community,
    viewer.active
  );

  return {
    community,
    viewerMode: viewer.mode,
    activeMembership: viewer.active,
    memberContentAccess,
    operational,
    canInteract: viewer.active && memberContentAccess && operational,
  };
}
