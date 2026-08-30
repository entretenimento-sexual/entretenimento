// -----------------------------------------------------------------------------
// GET COMMUNITY HIGHLIGHT
// -----------------------------------------------------------------------------
// Lê somente o metadado editorial necessário para a UI localizar o conteúdo
// original. O alvo continua sujeito às mesmas regras de leitura do Mural.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  canViewerReadCommunityFeedAudience,
  resolveCommunityFeedContentAccess,
} from './community-feed-access.policy';
import { sanitizeCommunityFeedProjection } from './community-feed.model';
import {
  isCommunityHighlightActive,
  normalizeCommunityHighlightReadRequest,
  normalizeCommunityHighlightSnapshot,
  type CommunityHighlightReadRequest,
  type CommunityHighlightReadResponse,
} from './community-highlight.model';
import { evaluateCommunityHighlightAction } from './community-highlight.policy';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertHighlightRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'Os destaques da Comunidade ainda não estão disponíveis neste ambiente.',
    { reason: 'community_highlight_unavailable' }
  );
}

export const getCommunityHighlight = onCall<CommunityHighlightReadRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityHighlightReadResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertHighlightRuntime();

    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Usuário não autenticado.',
        { reason: 'authentication_required' }
      );
    }
    if (request.auth?.token?.['email_verified'] !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail para continuar.',
        { reason: 'email_verification_required' }
      );
    }

    const readRequest = normalizeCommunityHighlightReadRequest(request.data);
    if (!readRequest.communityId) {
      throw new HttpsError(
        'invalid-argument',
        'Comunidade inválida.',
        { reason: 'invalid_community_id' }
      );
    }

    const communityId = readRequest.communityId;
    const context = await getCommunityViewerContext(uid, communityId);
    const now = Date.now();
    const highlightSnapshot = await db
      .collection('community_highlights')
      .doc(communityId)
      .get();
    const highlight = highlightSnapshot.exists
      ? normalizeCommunityHighlightSnapshot(highlightSnapshot.data())
      : null;

    let visibleHighlight = highlight && isCommunityHighlightActive(highlight, now)
      ? highlight
      : null;

    if (visibleHighlight?.targetType === 'feed_post') {
      const projectionSnapshot = await db
        .collection('community_public_feed')
        .doc(communityId)
        .collection('items')
        .doc(visibleHighlight.targetId)
        .get();
      const projection = projectionSnapshot.exists
        ? sanitizeCommunityFeedProjection(
          projectionSnapshot.id,
          projectionSnapshot.data(),
          now
        )
        : null;
      const feedContentAccess = resolveCommunityFeedContentAccess(
        context.memberContentAccess,
        context.authenticatedPreviewAccess
      );

      if (
        !projection
        || !canViewerReadCommunityFeedAudience(projection, feedContentAccess)
      ) {
        visibleHighlight = null;
      }
    }

    const managementDecision = evaluateCommunityHighlightAction({
      action: 'unpin',
      sourceType: context.community.source.type,
      communityOperational: context.operational,
      membershipStatus: context.activeMembership ? 'active' : null,
      viewerRole: context.viewerRole,
    });

    return {
      communityId,
      highlight: visibleHighlight,
      canManage: managementDecision.allowed,
      generatedAt: now,
    };
  }
);
