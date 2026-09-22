// -----------------------------------------------------------------------------
// SET COMMUNITY FEED REACTION
// -----------------------------------------------------------------------------
// Reação binária transacional orientada ao estado desejado. O cliente envia se
// a publicação deve terminar curtida ou não; retries da mesma intenção tornam-se
// idempotentes e nunca invertem acidentalmente uma reação já confirmada.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, Timestamp } from '../firebaseApp';
import {
  buildBilateralBlockPaths,
  isBilateralBlockActive,
} from '../friendship/application/bilateral-block-access.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { isCommunityMemberActivityEnabledStatus } from './community-lifecycle.policy';
import { assertCommunityMembershipActorEligibleInTransaction } from './community-membership-eligibility.service';
import {
  resolveCommunityNotificationMembershipCycleStartedAtMs,
} from './community-notification-membership.policy';
import {
  buildCommunityNotificationRoute,
  buildCommunityReactionNotificationCopy,
  buildCommunityReactionNotificationId,
  canReceiveCommunityActivityNotification,
  type CommunityNotificationUser,
} from './community-notification.policy';
import { evaluateCommunityFeedReaction } from './community-feed-reaction.policy';
import type { CommunityViewerRole } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { getCommunityViewerContext } from './community-viewer-access.service';

interface ToggleCommunityFeedReactionRequest {
  communityId?: unknown;
  postId?: unknown;
  reacted?: unknown;
}

interface ToggleCommunityFeedReactionResponse {
  communityId: string;
  postId: string;
  reacted: boolean;
  reactionCount: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'As reações do Mural ainda não estão disponíveis neste ambiente.',
    { reason: 'community_feed_reactions_unavailable' }
  );
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = cleanId(auth?.uid);
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

function throwDenied(reason: string | null): never {
  if (reason === 'active_membership_required') {
    throw new HttpsError(
      'permission-denied',
      'Participe da Comunidade para reagir.',
      { reason: 'active_membership_required' }
    );
  }
  throw new HttpsError(
    'failed-precondition',
    'Esta publicação não aceita reações.',
    { reason: reason || 'community_feed_reaction_unavailable' }
  );
}

export const toggleCommunityFeedReaction = onCall<
  ToggleCommunityFeedReactionRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<ToggleCommunityFeedReactionResponse> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const communityId = cleanId(request.data?.communityId);
    const postId = cleanId(request.data?.postId);
    const desiredReacted = request.data?.reacted;
    if (!communityId || !postId || typeof desiredReacted !== 'boolean') {
      throw new HttpsError(
        'invalid-argument',
        'Publicação ou estado da reação inválido.',
        { reason: 'invalid_reaction_request' }
      );
    }

    const context = await getCommunityViewerContext(actorUid, communityId);
    if (!context.canInteract) {
      throw new HttpsError(
        'permission-denied',
        'Participe da Comunidade para reagir.',
        { reason: 'active_membership_required' }
      );
    }
    await consumeCommunityRateLimit({
      action: 'feed_reaction',
      actorUid,
    });

    return db.runTransaction(async (transaction): Promise<ToggleCommunityFeedReactionResponse> => {
      const communityRef = db.collection('communities').doc(communityId);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
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
      const reactionRef = postRef.collection('reactions').doc(actorUid);
      const userReactionRef = db
        .collection('community_feed_user_reactions')
        .doc(actorUid)
        .collection('items')
        .doc(`${communityId}:${postId}`);
      const [
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        postSnapshot,
        projectionSnapshot,
        reactionSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(postRef),
        transaction.get(projectionRef),
        transaction.get(reactionRef),
      ]);

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
      await assertCommunityMembershipActorEligibleInTransaction(
        transaction,
        actorUid,
        userSnapshot.exists ? userSnapshot.data() : null
      );

      const community = communitySnapshot.data() ?? {};
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
      const membership = membershipSnapshot.exists
        ? membershipSnapshot.data() ?? {}
        : {};
      const post = postSnapshot.data() ?? {};
      const decision = evaluateCommunityFeedReaction({
        sourceType: source['type'],
        memberActivityAllowed:
          moderation['state'] === 'active'
          && isCommunityMemberActivityEnabledStatus(community['status']),
        membershipStatus: membership['status'],
        viewerRole: normalizeRole(membership['role']),
        postStatus: post['status'],
        postModerationState: post['moderationState'],
      });
      if (!decision.allowed) throwDenied(decision.denialReason);

      const now = Date.now();
      const metrics = (post['metrics'] ?? {}) as Record<string, unknown>;
      const currentCount = normalizeCount(metrics['reactionCount']);
      const currentlyReacted = reactionSnapshot.exists;
      const stateChanged = currentlyReacted !== desiredReacted;
      const shouldCreateReactionNotification =
        stateChanged && desiredReacted;
      const recipientUid = shouldCreateReactionNotification
        ? cleanId(post['actorUid'])
        : '';
      let notificationRef: FirebaseFirestore.DocumentReference | null = null;
      let membershipCycleStartedAtMs: number | null = null;
      let existingNotification: FirebaseFirestore.DocumentData | undefined;

      if (recipientUid && recipientUid !== actorUid) {
        const recipientUserRef = db.collection('users').doc(recipientUid);
        const recipientMembershipRef = communityRef
          .collection('members')
          .doc(recipientUid);
        const [actorBlockPath, recipientBlockPath] = buildBilateralBlockPaths(
          actorUid,
          recipientUid
        );
        const [
          recipientUserSnapshot,
          recipientMembershipSnapshot,
          actorBlockSnapshot,
          recipientBlockSnapshot,
        ] = await Promise.all([
          transaction.get(recipientUserRef),
          transaction.get(recipientMembershipRef),
          transaction.get(db.doc(actorBlockPath)),
          transaction.get(db.doc(recipientBlockPath)),
        ]);
        const recipientUser = recipientUserSnapshot.data() as
          | CommunityNotificationUser
          | undefined;

        membershipCycleStartedAtMs = recipientMembershipSnapshot.exists
          ? resolveCommunityNotificationMembershipCycleStartedAtMs(
            recipientMembershipSnapshot.data()
          )
          : null;

        const shouldNotify =
          membershipCycleStartedAtMs !== null
          && canReceiveCommunityActivityNotification(
            recipientUser,
            recipientUid,
            actorUid
          )
          && !isBilateralBlockActive({
            actorBlock: actorBlockSnapshot.data(),
            targetBlock: recipientBlockSnapshot.data(),
          });

        if (shouldNotify && membershipCycleStartedAtMs !== null) {
          notificationRef = db.collection('notifications').doc(
            buildCommunityReactionNotificationId(
              communityId,
              postId,
              recipientUid,
              membershipCycleStartedAtMs,
              now
            )
          );
          existingNotification = (await transaction.get(notificationRef)).data();
        }
      }
      const nextCount = !stateChanged
        ? currentCount
        : desiredReacted
          ? Math.min(currentCount + 1, 1_000_000_000)
          : Math.max(0, currentCount - 1);
      const updatedAt = Timestamp.fromMillis(now);

      if (desiredReacted) {
        if (!currentlyReacted) {
          transaction.create(reactionRef, { actorUid, createdAt: now });
        }
        // O espelho por usuário é reparado idempotentemente se tiver se perdido.
        transaction.set(userReactionRef, {
          actorUid,
          communityId,
          postId,
          createdAt: currentlyReacted
            ? Number(reactionSnapshot.data()?.['createdAt']) || now
            : now,
        });
      } else {
        if (currentlyReacted) transaction.delete(reactionRef);
        transaction.delete(userReactionRef);
      }

      if (stateChanged) {
        transaction.update(postRef, {
          'metrics.reactionCount': nextCount,
          updatedAt,
        });
        transaction.update(projectionRef, {
          'metrics.reactionCount': nextCount,
          updatedAt,
        });
      }

      if (
        notificationRef
        && membershipCycleStartedAtMs !== null
      ) {
        const copy = buildCommunityReactionNotificationCopy({
          existingActivityCount: existingNotification?.['activityCount'],
          communityName: community['name'],
        });

        transaction.set(notificationRef, {
          userId: recipientUid,
          type: 'community.post.reaction.received',
          title: copy.title,
          body: copy.body,
          route: buildCommunityNotificationRoute(communityId, postId),
          communityId,
          postId,
          membershipCycleStartedAtMs,
          activityCount: copy.activityCount,
          actorUid,
          readAt: null,
          createdAt: updatedAt,
          updatedAt,
        }, { merge: true });
      }

      return {
        communityId,
        postId,
        reacted: desiredReacted,
        reactionCount: nextCount,
      };
    });
  }
);
