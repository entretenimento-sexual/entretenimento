// functions/src/community/get-community-feed-page.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY FEED PAGE
// -----------------------------------------------------------------------------
// Mural comunitário paginado e somente leitura. Texto e foto compartilham a
// mesma timeline. Conteúdo sensível e capacidades são hidratados no backend.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  canViewerReadCommunityFeedAudience,
  canViewerReadCommunityFeedProjection,
  resolveCommunityFeedContentAccess,
} from './community-feed-access.policy';
import {
  CommunityFeedPageRequest,
  CommunityFeedPageResponse,
  SanitizedCommunityFeedProjection,
  normalizeCommunityFeedPageRequest,
  sanitizeCommunityFeedProjection,
} from './community-feed.model';
import { hydrateCommunityFeedItemsForViewer } from './community-feed-read.service';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'O mural comunitário ainda não está disponível neste ambiente.'
  );
}

function assertValidCursor(
  raw: CommunityFeedPageRequest | null | undefined,
  normalizedCursor: string | null
): void {
  const provided = String(raw?.cursor ?? '').trim();

  if (provided && !normalizedCursor) {
    throw new HttpsError('invalid-argument', 'Cursor de paginação inválido.');
  }
}

export const getCommunityFeedPage = onCall<CommunityFeedPageRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityFeedPageResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertPreviewRuntime();

    const uid = request.auth?.uid ?? null;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (request.auth?.token.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail para continuar.'
      );
    }

    const pageRequest = normalizeCommunityFeedPageRequest(request.data);
    assertValidCursor(request.data, pageRequest.cursor);

    if (!pageRequest.communityId) {
      throw new HttpsError('invalid-argument', 'Comunidade inválida.');
    }

    const context = await getCommunityViewerContext(uid, pageRequest.communityId);
    const feedContentAccess = resolveCommunityFeedContentAccess(
      context.memberContentAccess,
      context.authenticatedPreviewAccess
    );
    const feedCollection = db
      .collection('community_public_feed')
      .doc(pageRequest.communityId)
      .collection('items');
    const scanLimit = pageRequest.limit * 3 + 1;
    const now = Date.now();
    let pageQuery = feedCollection
      .orderBy('publishedAt', 'desc')
      .limit(scanLimit);

    if (pageRequest.cursor) {
      const cursorSnapshot = await feedCollection.doc(pageRequest.cursor).get();
      const cursorProjection = cursorSnapshot.exists
        ? sanitizeCommunityFeedProjection(
          cursorSnapshot.id,
          cursorSnapshot.data(),
          now
        )
        : null;

      if (
        !cursorProjection
        || !canViewerReadCommunityFeedAudience(
          cursorProjection,
          feedContentAccess
        )
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Cursor de paginação não encontrado.'
        );
      }

      pageQuery = pageQuery.startAfter(cursorSnapshot);
    }

    const querySnapshot = await pageQuery.get();
    const projections: SanitizedCommunityFeedProjection[] = [];

    for (const document of querySnapshot.docs) {
      const projection = sanitizeCommunityFeedProjection(
        document.id,
        document.data(),
        now
      );

      if (
        !projection
        || !canViewerReadCommunityFeedProjection(
          projection,
          pageRequest.view,
          feedContentAccess
        )
      ) {
        continue;
      }

      projections.push(projection);
    }

    const hydratedItems = await hydrateCommunityFeedItemsForViewer({
      communityId: pageRequest.communityId,
      uid,
      projections,
      context,
      now,
    });
    const items = hydratedItems.slice(0, pageRequest.limit);
    let lastConsumedDocument:
      FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let mayHaveAnotherPage = false;

    if (items.length >= pageRequest.limit) {
      const lastVisiblePostId = items.at(-1)?.postId ?? '';
      const lastVisibleIndex = querySnapshot.docs.findIndex(
        (document) => document.id === lastVisiblePostId
      );

      lastConsumedDocument = lastVisibleIndex >= 0
        ? querySnapshot.docs[lastVisibleIndex] ?? null
        : querySnapshot.docs.at(-1) ?? null;
      mayHaveAnotherPage =
        querySnapshot.docs.length === scanLimit
        || (
          lastVisibleIndex >= 0
          && lastVisibleIndex < querySnapshot.docs.length - 1
        );
    } else {
      lastConsumedDocument = querySnapshot.docs.at(-1) ?? null;
      mayHaveAnotherPage = querySnapshot.docs.length === scanLimit;
    }

    return {
      items,
      nextCursor: mayHaveAnotherPage
        ? (lastConsumedDocument?.id ?? null)
        : null,
      generatedAt: now,
    };
  }
);
