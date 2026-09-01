// -----------------------------------------------------------------------------
// CREATE COMMUNITY FEED CONVERSATION MESSAGE
// -----------------------------------------------------------------------------
// Mantém o nome da callable por compatibilidade. Toda nova mensagem pertence à
// mesma coleção `comments`; respostas usam apenas `replyToCommentId`, sem
// subcoleção/árvore. O backend valida a referência e hidrata a citação na leitura.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, Timestamp } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  buildBilateralBlockPaths,
  isBilateralBlockActive,
} from '../friendship/application/bilateral-block-access.policy';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  CommunityFeedCommentCreateRequest,
  CommunityFeedCommentCreateResponse,
  normalizeCommunityFeedCommentCreateRequest,
  sanitizeCommunityFeedComment,
} from './community-feed-comment.model';
import { evaluateCommunityFeedCommentWrite } from './community-feed-comment.policy';
import { sanitizeCommunityFeedProjection } from './community-feed.model';
import { buildCommunityPublicAuthor } from './community-public-author.model';
import { isCommunityMemberActivityEnabledStatus } from './community-lifecycle.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  allowsCommunityActivityNotifications,
  buildCommunityCommentNotificationCopy,
  buildCommunityCommentNotificationId,
  buildCommunityNotificationRoute,
  buildCommunityReplyNotificationCopy,
  buildCommunityReplyNotificationId,
  canReceiveCommunityActivityNotification,
  type CommunityNotificationPreferences,
  type CommunityNotificationUser,
} from './community-notification.policy';
import type { CommunityViewerRole } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { getCommunityViewerContext } from './community-viewer-access.service';

type FlatConversationCreateRequest = CommunityFeedCommentCreateRequest & {
  replyToCommentId?: unknown;
};

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'A conversa do Mural ainda não está disponível neste ambiente.',
    { reason: 'community_feed_conversation_unavailable' }
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Usuário não autenticado.',
      { reason: 'authentication_required' }
    );
  }
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.',
      { reason: 'email_verification_required' }
    );
  }
  return uid;
}

function normalizeRole(value: unknown): CommunityViewerRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), 1_000_000_000)
    : 0;
}

function normalizeOptionalSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function throwDenied(reason: string | null): never {
  if (reason === 'active_membership_required') {
    throw new HttpsError(
      'permission-denied',
      'Participe da Comunidade para conversar.',
      { reason }
    );
  }
  if (reason === 'post_unavailable') {
    throw new HttpsError(
      'failed-precondition',
      'A publicação não aceita mensagens.',
      { reason }
    );
  }
  throw new HttpsError(
    'failed-precondition',
    'O Mural não aceita mensagens agora.',
    { reason: reason ?? 'community_unavailable' }
  );
}

function existingResponse(
  raw: FirebaseFirestore.DocumentData,
  actorUid: string,
  communityId: string,
  postId: string,
  commentId: string,
  replyToCommentId: string | null
): CommunityFeedCommentCreateResponse | null {
  const storedReplyTo = normalizeOptionalSafeId(raw['replyToCommentId']);
  if (
    raw['kind'] !== 'comment_create'
    || raw['actorUid'] !== actorUid
    || raw['communityId'] !== communityId
    || raw['postId'] !== postId
    || raw['commentId'] !== commentId
    || storedReplyTo !== replyToCommentId
  ) {
    return null;
  }
  return {
    communityId,
    postId,
    commentId,
    commentCount: normalizeCount(raw['commentCount']),
    created: false,
    deduplicated: true,
  };
}

export const createCommunityFeedComment = onCall<FlatConversationCreateRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityFeedCommentCreateResponse> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityFeedCommentCreateRequest(request.data);
    const rawReplyToCommentId = String(request.data?.replyToCommentId ?? '').trim();
    const replyToCommentId = normalizeOptionalSafeId(rawReplyToCommentId);
    if (
      !command.requestId
      || !command.communityId
      || !command.postId
      || !command.text
      || command.textTooLong
      || (rawReplyToCommentId && !replyToCommentId)
      || replyToCommentId === command.requestId
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Mensagem inválida.',
        { reason: 'invalid_conversation_message' }
      );
    }

    const communityId = command.communityId;
    const postId = command.postId;
    const commentId = command.requestId;
    const requestRef = db.collection('community_feed_requests').doc(commentId);
    const preexisting = await requestRef.get();
    if (preexisting.exists) {
      const response = existingResponse(
        preexisting.data() ?? {},
        actorUid,
        communityId,
        postId,
        commentId,
        replyToCommentId
      );
      if (!response) {
        throw new HttpsError(
          'already-exists',
          'Este identificador já foi utilizado.',
          { reason: 'request_id_conflict' }
        );
      }
      return response;
    }

    const context = await getCommunityViewerContext(actorUid, communityId);
    if (!context.canInteract) {
      throw new HttpsError(
        'permission-denied',
        'Participe da Comunidade para conversar.',
        { reason: 'active_membership_required' }
      );
    }
    await consumeCommunityRateLimit({
      action: 'feed_conversation',
      actorUid,
    });

    return db.runTransaction(async (transaction): Promise<CommunityFeedCommentCreateResponse> => {
      const communityRef = db.collection('communities').doc(communityId);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const publicProfileRef = db.collection('public_profiles').doc(actorUid);
      const postRef = db
        .collection('community_feed_posts')
        .doc(communityId)
        .collection('items')
        .doc(postId);
      const projectionRef = db
        .collection('community_public_feed')
        .doc(communityId)
        .collection('items')
        .doc(postId);
      const commentsRef = postRef.collection('comments');
      const commentRef = commentsRef.doc(commentId);
      const replyTargetRef = replyToCommentId
        ? commentsRef.doc(replyToCommentId)
        : null;
      const userCommentRef = db
        .collection('community_feed_user_comments')
        .doc(actorUid)
        .collection('items')
        .doc(`${communityId}:${postId}:${commentId}`);
      const auditRef = db
        .collection('community_feed_audit')
        .doc(`comment-${commentId}`);

      const replyTargetPromise = replyTargetRef
        ? transaction.get(replyTargetRef)
        : Promise.resolve(null);
      const [
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        publicProfileSnapshot,
        postSnapshot,
        projectionSnapshot,
        commentSnapshot,
        requestSnapshot,
        replyTargetSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(publicProfileRef),
        transaction.get(postRef),
        transaction.get(projectionRef),
        transaction.get(commentRef),
        transaction.get(requestRef),
        replyTargetPromise,
      ]);

      if (requestSnapshot.exists) {
        const response = existingResponse(
          requestSnapshot.data() ?? {},
          actorUid,
          communityId,
          postId,
          commentId,
          replyToCommentId
        );
        if (!response) {
          throw new HttpsError(
            'already-exists',
            'Este identificador já foi utilizado.',
            { reason: 'request_id_conflict' }
          );
        }
        return response;
      }
      if (!communitySnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Comunidade não encontrada.',
          { reason: 'community_not_found' }
        );
      }
      if (!postSnapshot.exists || !projectionSnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Publicação não encontrada.',
          { reason: 'community_feed_post_not_found' }
        );
      }
      if (commentSnapshot.exists) {
        throw new HttpsError(
          'already-exists',
          'Esta mensagem já existe.',
          { reason: 'conversation_message_already_exists' }
        );
      }
      assertCommunityMembershipActorEligible(
        userSnapshot.exists ? userSnapshot.data() : null,
        actorUid
      );

      const community = communitySnapshot.data() ?? {};
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
      const membership = membershipSnapshot.exists
        ? membershipSnapshot.data() ?? {}
        : {};
      const post = postSnapshot.data() ?? {};
      const projection = sanitizeCommunityFeedProjection(
        postId,
        projectionSnapshot.data()
      );
      if (!projection) {
        throw new HttpsError(
          'failed-precondition',
          'A publicação não aceita mensagens.',
          { reason: 'post_unavailable' }
        );
      }

      const replyTarget = replyToCommentId && replyTargetSnapshot
        ? sanitizeCommunityFeedComment(
          replyToCommentId,
          replyTargetSnapshot.data()
        )
        : null;
      if (replyToCommentId && !replyTarget) {
        throw new HttpsError(
          'failed-precondition',
          'A mensagem original não está disponível para resposta.',
          { reason: 'referenced_message_unavailable' }
        );
      }

      const decision = evaluateCommunityFeedCommentWrite({
        sourceType: source['type'],
        memberActivityAllowed:
          moderation['state'] === 'active'
          && isCommunityMemberActivityEnabledStatus(community['status']),
        membershipStatus: membership['status'],
        viewerRole: normalizeRole(membership['role']),
        postKind: post['kind'],
        postStatus: post['status'],
        postModerationState: post['moderationState'],
      });
      if (!decision.allowed) throwDenied(decision.denialReason);

      const nowMs = Date.now();
      const recipientUid = replyTarget?.actorUid
        ?? String(post['actorUid'] ?? '').trim();
      const notificationRef = recipientUid && recipientUid !== actorUid
        ? db.collection('notifications').doc(
          replyToCommentId
            ? buildCommunityReplyNotificationId(
              communityId,
              postId,
              replyToCommentId,
              recipientUid,
              nowMs
            )
            : buildCommunityCommentNotificationId(
              communityId,
              postId,
              recipientUid,
              nowMs
            )
        )
        : null;
      let shouldNotify = false;
      let existingNotification: FirebaseFirestore.DocumentData | undefined;

      if (notificationRef) {
        const recipientUserRef = db.collection('users').doc(recipientUid);
        const recipientPreferencesRef = db
          .collection('preferences')
          .doc(recipientUid);
        const [actorBlockPath, recipientBlockPath] = buildBilateralBlockPaths(
          actorUid,
          recipientUid
        );
        const [
          recipientUserSnapshot,
          recipientPreferencesSnapshot,
          notificationSnapshot,
          actorBlockSnapshot,
          recipientBlockSnapshot,
        ] = await Promise.all([
          transaction.get(recipientUserRef),
          transaction.get(recipientPreferencesRef),
          transaction.get(notificationRef),
          transaction.get(db.doc(actorBlockPath)),
          transaction.get(db.doc(recipientBlockPath)),
        ]);
        const recipientUser = recipientUserSnapshot.data() as
          | CommunityNotificationUser
          | undefined;
        const recipientPreferences = recipientPreferencesSnapshot.data() as
          | CommunityNotificationPreferences
          | undefined;

        shouldNotify = canReceiveCommunityActivityNotification(
          recipientUser,
          recipientUid,
          actorUid
        )
          && allowsCommunityActivityNotifications(recipientPreferences)
          && !isBilateralBlockActive({
            actorBlock: actorBlockSnapshot.data(),
            targetBlock: recipientBlockSnapshot.data(),
          });
        existingNotification = notificationSnapshot.data();
      }

      const metrics = (post['metrics'] ?? {}) as Record<string, unknown>;
      // `commentCount` passa a representar o total de mensagens da conversa.
      const commentCount = Math.min(
        normalizeCount(metrics['commentCount']) + 1,
        1_000_000_000
      );
      const now = Timestamp.fromMillis(nowMs);
      // Nome civil/KYC nunca é fallback de identidade pública.
      const author = buildCommunityPublicAuthor(
        publicProfileSnapshot.exists ? publicProfileSnapshot.data() : null,
        { label: 'Participante', avatarUrl: null }
      );

      transaction.create(commentRef, {
        commentId,
        communityId,
        postId,
        actorUid,
        author,
        text: command.text,
        replyToCommentId,
        metrics: { replyCount: 0 },
        status: 'active',
        moderationState: 'active',
        createdAt: now,
        updatedAt: now,
      });
      transaction.create(userCommentRef, {
        actorUid,
        communityId,
        postId,
        commentId,
        replyToCommentId,
        createdAt: nowMs,
      });
      transaction.create(requestRef, {
        requestId: commentId,
        kind: 'comment_create',
        actorUid,
        communityId,
        postId,
        commentId,
        replyToCommentId,
        commentCount,
        completedAt: nowMs,
        createdAt: nowMs,
      });
      transaction.create(auditRef, {
        action: replyToCommentId
          ? 'community-feed-conversation-reply-created'
          : 'community-feed-comment-created',
        actorUid,
        communityId,
        postId,
        commentId,
        replyToCommentId,
        createdAt: nowMs,
      });
      transaction.update(postRef, {
        'metrics.commentCount': commentCount,
        updatedAt: now,
      });
      transaction.update(projectionRef, {
        'metrics.commentCount': commentCount,
        updatedAt: now,
      });

      if (shouldNotify && notificationRef) {
        const copy = replyToCommentId
          ? buildCommunityReplyNotificationCopy({
            existingActivityCount: existingNotification?.['activityCount'],
            actorLabel: author.label,
            communityName: community['name'],
          })
          : buildCommunityCommentNotificationCopy({
            existingActivityCount: existingNotification?.['activityCount'],
            actorLabel: author.label,
            communityName: community['name'],
          });
        transaction.set(notificationRef, {
          userId: recipientUid,
          type: replyToCommentId
            ? 'community.comment.reply.received'
            : 'community.comment.received',
          title: copy.title,
          body: copy.body,
          route: buildCommunityNotificationRoute(communityId),
          communityId,
          postId,
          commentId,
          replyToCommentId,
          activityCount: copy.activityCount,
          actorUid,
          readAt: null,
          createdAt: now,
          updatedAt: now,
        }, { merge: true });
      }

      return {
        communityId,
        postId,
        commentId,
        commentCount,
        created: true,
        deduplicated: false,
      };
    });
  }
);
