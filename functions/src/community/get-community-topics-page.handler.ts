// functions/src/community/get-community-topics-page.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY TOPICS PAGE
// -----------------------------------------------------------------------------
// Lista paginada de discussões persistentes. A projeção é backend-only e cada
// chamada revalida acesso à Comunidade antes de devolver qualquer tópico.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  canViewerReadCommunityTopicProjection,
  resolveCommunityTopicContentAccess,
} from './community-topic-access.policy';
import {
  CommunityTopicListItem,
  CommunityTopicPageRequest,
  CommunityTopicPageResponse,
  normalizeCommunityTopicPageRequest,
  sanitizeCommunityTopicProjection,
} from './community-topic.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertTopicsRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'Os Tópicos de Comunidade ainda não estão disponíveis neste ambiente.'
  );
}

function assertValidCursor(
  raw: CommunityTopicPageRequest | null | undefined,
  normalizedCursor: string | null
): void {
  const provided = String(raw?.cursor ?? '').trim();

  if (provided && !normalizedCursor) {
    throw new HttpsError('invalid-argument', 'Cursor de paginação inválido.');
  }
}

export const getCommunityTopicsPage = onCall<CommunityTopicPageRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityTopicPageResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertTopicsRuntime();

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

    const pageRequest = normalizeCommunityTopicPageRequest(request.data);
    assertValidCursor(request.data, pageRequest.cursor);

    if (!pageRequest.communityId) {
      throw new HttpsError('invalid-argument', 'Comunidade inválida.');
    }

    const context = await getCommunityViewerContext(uid, pageRequest.communityId);
    const topicContentAccess = resolveCommunityTopicContentAccess(
      context.memberContentAccess,
      context.authenticatedPreviewAccess
    );
    const topicsCollection = db
      .collection('community_public_topics')
      .doc(pageRequest.communityId)
      .collection('items');
    const scanLimit = pageRequest.limit * 3 + 1;
    const now = Date.now();
    let pageQuery = topicsCollection
      .orderBy('lastActivityAt', 'desc')
      .limit(scanLimit);

    if (pageRequest.cursor) {
      const cursorSnapshot = await topicsCollection.doc(pageRequest.cursor).get();
      const cursorProjection = cursorSnapshot.exists
        ? sanitizeCommunityTopicProjection(
          cursorSnapshot.id,
          cursorSnapshot.data(),
          now
        )
        : null;

      if (
        !cursorProjection
        || !canViewerReadCommunityTopicProjection(
          cursorProjection,
          topicContentAccess
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
    const items: CommunityTopicListItem[] = [];
    let lastConsumedIndex = -1;

    for (let index = 0; index < querySnapshot.docs.length; index += 1) {
      const document = querySnapshot.docs[index];
      lastConsumedIndex = index;
      const projection = sanitizeCommunityTopicProjection(
        document.id,
        document.data(),
        now
      );

      if (
        !projection
        || !canViewerReadCommunityTopicProjection(
          projection,
          topicContentAccess
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
