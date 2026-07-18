// functions/src/community/get-community-preview.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY PREVIEW
// -----------------------------------------------------------------------------
// Retorna somente metadados comunitários sanitizados e o papel do próprio viewer.
// Publicações, mídia e listas de membros não fazem parte deste endpoint.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  CommunityPreviewRequest,
  CommunityPreviewResponse,
  normalizeCommunityId,
  resolveCommunityViewerMode,
  sanitizeCommunityDocument,
} from './community-preview.model';

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

export const getCommunityPreview = onCall<CommunityPreviewRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CommunityPreviewResponse> => {
    assertPreviewRuntime();

    const uid = request.auth?.uid ?? null;
    if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');

    if (request.auth?.token.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail para continuar.'
      );
    }

    const communityId = normalizeCommunityId(request.data?.communityId);
    if (!communityId) {
      throw new HttpsError('invalid-argument', 'Comunidade inválida.');
    }

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
    const membershipRaw = membershipSnapshot.exists
      ? membershipSnapshot.data()
      : null;
    const viewer = resolveCommunityViewerMode(membershipRaw);
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
      canInteract: viewer.active && operational,
      generatedAt: Date.now(),
    };
  }
);
