// functions/src/community/get-community-topic-detail.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY TOPIC DETAIL / REPLIES
// -----------------------------------------------------------------------------
// Leitura autoritativa de uma discussão persistente e de suas respostas.
// O navegador nunca consulta community_topics/community_public_topics direto.
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
  canViewerReadCommunityTopicAudience,
  canViewerReplyToCommunityTopic,
  resolveCommunityTopicContentAccess,
} from './community-topic-access.policy';
import {
  CommunityTopicDetailRequest,
  CommunityTopicDetailResponse,
  CommunityTopicRepliesPageRequest,
  CommunityTopicRepliesPageResponse,
  CommunityTopicReplyItem,
  normalizeCommunityTopicDetailRequest,
  normalizeCommunityTopicRepliesPageRequest,
  sanitizeCommunityTopicDetail,
  sanitizeCommunityTopicReplyProjection,
} from './community-topic-detail.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertTopicsRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'Os Tópicos de Comunidades ainda não estão disponíveis neste ambiente.'
  );
}

function assertAuthenticatedViewer(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.'
    );
  }

  return uid;
}

function assertReadableTopic(
  audience: 'public_preview' | 'members_only',
  topicContentAccess: boolean
): void {
  if (!canViewerReadCommunityTopicAudience(audience, topicContentAccess)) {
    throw new HttpsError(
      'permission-denied',
      'Você não possui acesso a este Tópico.'
    );
  }
}

function assertValidReplyCursor(
  raw: CommunityTopicRepliesPageRequest | null | undefined,
  normalizedCursor: string | null
): void {
  const provided = String(raw?.cursor ?? '').trim();

  if (provided && !normalizedCursor) {
    throw new HttpsError('invalid-argument', 'Cursor de respostas inválido.');
  }
}

export const getCommunityTopicDetail = onCall<CommunityTopicDetailRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityTopicDetailResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertTopicsRuntime();
    const uid = assertAuthenticatedViewer(request.auth);
    const command = normalizeCommunityTopicDetailRequest(request.data);

    if (!command.communityId || !command.topicId) {
      throw new HttpsError('invalid-argument', 'Tópico inválido.');
    }

    const context = await getCommunityViewerContext(uid, command.communityId);
    const topicContentAccess = resolveCommunityTopicContentAccess(
      context.memberContentAccess,
      context.authenticatedPreviewAccess
    );
    const now = Date.now();
    const topicSnapshot = await db
      .collection('community_topics')
      .doc(command.communityId)
      .collection('items')
      .doc(command.topicId)
      .get();
    const detail = topicSnapshot.exists
      ? sanitizeCommunityTopicDetail(
        topicSnapshot.id,
        topicSnapshot.data(),
        now
      )
      : null;

    if (!detail) {
      throw new HttpsError('not-found', 'Tópico não encontrado.');
    }

    assertReadableTopic(detail.audience, topicContentAccess);

    return {
      topic: detail.item,
      canReply: canViewerReplyToCommunityTopic(
        detail.item.status,
        context.canInteract
      ),
      generatedAt: now,
    };
  }
);

export const getCommunityTopicRepliesPage = onCall<CommunityTopicRepliesPageRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityTopicRepliesPageResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertTopicsRuntime();
    const uid = assertAuthenticatedViewer(request.auth);
    const command = normalizeCommunityTopicRepliesPageRequest(request.data);
    assertValidReplyCursor(request.data, command.cursor);

    if (!command.communityId || !command.topicId) {
      throw new HttpsError('invalid-argument', 'Tópico inválido.');
    }

    const context = await getCommunityViewerContext(uid, command.communityId);
    const topicContentAccess = resolveCommunityTopicContentAccess(
      context.memberContentAccess,
      context.authenticatedPreviewAccess
    );
    const now = Date.now();
    const topicSnapshot = await db
      .collection('community_topics')
      .doc(command.communityId)
      .collection('items')
      .doc(command.topicId)
      .get();
    const detail = topicSnapshot.exists
      ? sanitizeCommunityTopicDetail(
        topicSnapshot.id,
        topicSnapshot.data(),
        now
      )
      : null;

    if (!detail) {
      throw new HttpsError('not-found', 'Tópico não encontrado.');
    }

    assertReadableTopic(detail.audience, topicContentAccess);

    const repliesCollection = db
      .collection('community_public_topics')
      .doc(command.communityId)
      .collection('items')
      .doc(command.topicId)
      .collection('replies');
    const scanLimit = command.limit * 3 + 1;
    let pageQuery = repliesCollection
      .orderBy('createdAt', 'asc')
      .limit(scanLimit);

    if (command.cursor) {
      const cursorSnapshot = await repliesCollection.doc(command.cursor).get();

      if (!cursorSnapshot.exists) {
        throw new HttpsError(
          'invalid-argument',
          'Cursor de respostas não encontrado.'
        );
      }

      pageQuery = pageQuery.startAfter(cursorSnapshot);
    }

    const querySnapshot = await pageQuery.get();
    const items: CommunityTopicReplyItem[] = [];
    let lastConsumedIndex = -1;

    for (let index = 0; index < querySnapshot.docs.length; index += 1) {
      const document = querySnapshot.docs[index];
      lastConsumedIndex = index;
      const reply = sanitizeCommunityTopicReplyProjection(
        document.id,
        document.data(),
        now
      );

      if (!reply) continue;

      items.push(reply);
      if (items.length >= command.limit) break;
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
