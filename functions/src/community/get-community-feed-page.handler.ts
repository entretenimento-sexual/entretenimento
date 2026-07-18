// functions/src/community/get-community-feed-page.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY FEED PAGE
// -----------------------------------------------------------------------------
// Mural comunitário paginado e somente leitura. A projeção é backend-only e a
// audiência é reavaliada em cada chamada.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import { canViewerReadCommunityFeedProjection } from './community-feed-access.policy';
import {
  CommunityFeedItem,
  CommunityFeedPageRequest,
  CommunityFeedPageResponse,
  normalizeCommunityFeedPageRequest,
  sanitizeCommunityFeedProjection,
} from './community-feed.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

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
  { region: FUNCTIONS_REGION },
  async (request): Promise<CommunityFeedPageResponse> => {
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
    const feedCollection = db
      .collection('community_public_feed')
      .doc(pageRequest.communityId)
      .collection('items');
    const scanLimit = pageRequest.limit * 3 + 1;
    let pageQuery = feedCollection
      .orderBy('publishedAt', 'desc')
      .limit(scanLimit);

    if (pageRequest.cursor) {
      const cursorSnapshot = await feedCollection.doc(pageRequest.cursor).get();

      if (!cursorSnapshot.exists) {
        throw new HttpsError(
          'invalid-argument',
          'Cursor de paginação não encontrado.'
        );
      }

      pageQuery = pageQuery.startAfter(cursorSnapshot);
    }

    const now = Date.now();
    const querySnapshot = await pageQuery.get();
    const items: CommunityFeedItem[] = [];
    let lastConsumedIndex = -1;

    for (let index = 0; index < querySnapshot.docs.length; index += 1) {
      const document = querySnapshot.docs[index];
      lastConsumedIndex = index;
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
          context.activeMembership
        )
      ) {
        continue;
      }

      items.push(projection.item);

      if (items.length >= pageRequest.limit) break;
    }

    const lastConsumedDocument = lastConsumedIndex >= 0
      ? querySnapshot.docs[lastConsumedIndex]
      : null;
    const hasBufferedDocuments =
      lastConsumedIndex >= 0
      && lastConsumedIndex < querySnapshot.docs.length - 1;
    const mayHaveAnotherPage =
      querySnapshot.docs.length === scanLimit || hasBufferedDocuments;

    return {
      items,
      nextCursor: mayHaveAnotherPage
        ? (lastConsumedDocument?.id ?? null)
        : null,
      generatedAt: now,
    };
  }
);
