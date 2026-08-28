// -----------------------------------------------------------------------------
// GET COMMUNITY FEED COMMENT REPLIES PAGE
// -----------------------------------------------------------------------------
// Respostas são uma conversa rasa vinculada a um comentário do Mural. A leitura
// acompanha a mesma política do conteúdo do Mural: authenticated preview pode
// ler; participação ativa continua necessária somente para escrever.
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
import {
  CommunityFeedCommentReplyItem,
  CommunityFeedCommentReplyPageRequest,
  CommunityFeedCommentReplyPageResponse,
  SanitizedCommunityFeedCommentReply,
  normalizeCommunityFeedCommentReplyPageRequest,
  sanitizeCommunityFeedComment,
  sanitizeCommunityFeedCommentReply,
} from './community-feed-comment.model';
import { isCommunityFeedInteractivePostKind } from './community-feed-comment.policy';
import { sanitizeCommunityFeedProjection } from './community-feed.model';
import { buildCommunityPublicAuthor } from './community-public-author.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'As respostas dos comentários ainda não estão disponíveis neste ambiente.'
  );
}

function isManagementRole(value: unknown): boolean {
  return value === 'owner' || value === 'admin' || value === 'moderator';
}

export const getCommunityFeedCommentRepliesPage = onCall<
  CommunityFeedCommentReplyPageRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityFeedCommentReplyPageResponse> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    if (request.auth?.token.email_verified !== true) {
      throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
    }

    const page = normalizeCommunityFeedCommentReplyPageRequest(request.data);
    if (!page.communityId || !page.postId || !page.commentId) {
      throw new HttpsError('invalid-argument', 'Comentário inválido.');
    }
    if (String(request.data?.cursor ?? '').trim() && !page.cursor) {
      throw new HttpsError('invalid-argument', 'Cursor de resposta inválido.');
    }

    const context = await getCommunityViewerContext(uid, page.communityId);
    const feedContentAccess = resolveCommunityFeedContentAccess(
      context.memberContentAccess,
      context.authenticatedPreviewAccess
    );
    const postRef = db
      .collection('community_feed_posts')
      .doc(page.communityId)
      .collection('items')
      .doc(page.postId);
    const projectionRef = db
      .collection('community_public_feed')
      .doc(page.communityId)
      .collection('items')
      .doc(page.postId);
    const commentRef = postRef.collection('comments').doc(page.commentId);

    const [postSnapshot, projectionSnapshot, commentSnapshot] = await Promise.all([
      postRef.get(),
      projectionRef.get(),
      commentRef.get(),
    ]);
    const post = postSnapshot.exists ? postSnapshot.data() ?? {} : {};
    const postKind = post['kind'];
    const projection = projectionSnapshot.exists
      ? sanitizeCommunityFeedProjection(page.postId, projectionSnapshot.data())
      : null;
    const parentComment = commentSnapshot.exists
      ? sanitizeCommunityFeedComment(
        page.commentId,
        commentSnapshot.data()
      )
      : null;

    if (
      !postSnapshot.exists
      || !isCommunityFeedInteractivePostKind(postKind)
      || post['status'] !== 'active'
      || post['moderationState'] !== 'active'
      || !projection
      || projection.item.kind !== postKind
      || !parentComment
      || !canViewerReadCommunityFeedAudience(projection, feedContentAccess)
    ) {
      throw new HttpsError('not-found', 'Comentário não encontrado.');
    }

    const replies = commentRef.collection('replies');
    const scanLimit = page.limit * 3 + 1;
    let query = replies.orderBy('createdAt', 'asc').limit(scanLimit);
    if (page.cursor) {
      const cursorSnapshot = await replies.doc(page.cursor).get();
      if (!cursorSnapshot.exists) {
        throw new HttpsError('invalid-argument', 'Cursor de resposta não encontrado.');
      }
      query = query.startAfter(cursorSnapshot);
    }

    const snapshot = await query.get();
    const sanitizedReplies: SanitizedCommunityFeedCommentReply[] = [];
    let lastConsumedIndex = -1;
    const management = context.activeMembership
      && context.memberActivityAllowed
      && isManagementRole(context.viewerRole);
    const now = Date.now();

    for (let index = 0; index < snapshot.docs.length; index += 1) {
      const document = snapshot.docs[index];
      lastConsumedIndex = index;
      const sanitized = sanitizeCommunityFeedCommentReply(
        document.id,
        document.data(),
        page.commentId,
        now
      );
      if (!sanitized) continue;
      sanitizedReplies.push(sanitized);
      if (sanitizedReplies.length >= page.limit) break;
    }

    const uniqueAuthorUids = Array.from(new Set(
      sanitizedReplies.map((reply) => reply.actorUid).filter(Boolean)
    ));
    const publicProfileSnapshots = uniqueAuthorUids.length > 0
      ? await db.getAll(...uniqueAuthorUids.map((authorUid) =>
        db.collection('public_profiles').doc(authorUid)
      ))
      : [];
    const publicProfilesByUid = new Map(
      publicProfileSnapshots.map((profileSnapshot) => [
        profileSnapshot.id,
        profileSnapshot.exists ? profileSnapshot.data() ?? null : null,
      ] as const)
    );

    const items: CommunityFeedCommentReplyItem[] = sanitizedReplies.map((sanitized) => {
      const ownReply = sanitized.actorUid === uid;
      return {
        ...sanitized.item,
        author: buildCommunityPublicAuthor(
          publicProfilesByUid.get(sanitized.actorUid),
          sanitized.item.author
        ),
        capabilities: {
          canDeleteOwn: ownReply,
          canModerate: management && !ownReply,
          canReport: !ownReply,
        },
      };
    });

    const lastConsumedDocument = lastConsumedIndex >= 0
      ? snapshot.docs[lastConsumedIndex]
      : null;
    const hasBufferedDocuments = lastConsumedIndex >= 0
      && lastConsumedIndex < snapshot.docs.length - 1;

    return {
      items,
      nextCursor:
        snapshot.docs.length === scanLimit || hasBufferedDocuments
          ? lastConsumedDocument?.id ?? null
          : null,
      generatedAt: now,
    };
  }
);
