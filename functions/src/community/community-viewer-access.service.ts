// functions/src/community/community-viewer-access.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY VIEWER ACCESS
// -----------------------------------------------------------------------------
// Centraliza a leitura da comunidade e do vínculo do usuário. A UI nunca concede
// acesso; os handlers usam este serviço antes de devolver metadados ou mural.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../firebaseApp';
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
  operational: boolean;
  canInteract: boolean;
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

  return {
    community,
    viewerMode: viewer.mode,
    activeMembership: viewer.active,
    operational,
    canInteract: viewer.active && operational,
  };
}
