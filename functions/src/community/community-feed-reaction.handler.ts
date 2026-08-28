// -----------------------------------------------------------------------------
// TOGGLE COMMUNITY FEED REACTION
// -----------------------------------------------------------------------------
// Reação binária transacional. O documento por usuário torna concorrência e
// contagem determinísticas; a projeção continua servida somente pela callable.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, Timestamp } from '../firebaseApp';
import { consumeBackendRateLimitQuota } from '../media/application/backend-rate-limit.service';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { isCommunityMemberActivityEnabledStatus } from './community-lifecycle.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import { evaluateCommunityFeedReaction } from './community-feed-reaction.policy';
import type { CommunityViewerRole } from './community-preview.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

interface ToggleCommunityFeedReactionRequest {
  communityId?: unknown;
  postId?: unknown;
}

interface ToggleCommunityFeedReactionResponse {
  communityId: string;
  postId: string;
  reacted: boolean;
  reactionCount: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function assertRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;
  throw new HttpsError(
    'failed-precondition',
    'As reações do Mural ainda não estão disponíveis neste ambiente.'
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
  if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
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
    throw new HttpsError('permission-denied', 'Participe da Comunidade para reagir.');
  }
  throw new HttpsError('failed-precondition', 'Esta publicação não aceita reações.');
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
    if (!communityId || !postId) {
      throw new HttpsError('invalid-argument', 'Publicação inválida.');
    }

    const context = await getCommunityViewerContext(actorUid, communityId);
    if (!context.canInteract) {
      throw new HttpsError('permission-denied', 'Participe da Comunidade para reagir.');
    }
    await consumeBackendRateLimitQuota({
      action: 'toggleCommunityFeedReaction',
      subject: actorUid,
      cost: 1,
      config: {
        burstWindowMs: 60 * 1_000,
        burstMax: 40,
        sustainedWindowMs: 10 * 60 * 1_000,
        sustainedMax: 180,
      },
      message: 'Muitas reações foram enviadas em pouco tempo.',
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
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }
      if (!postSnapshot.exists || !projectionSnapshot.exists) {
        throw new HttpsError('not-found', 'Publicação não encontrada.');
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

      const metrics = (post['metrics'] ?? {}) as Record<string, unknown>;
      const currentCount = normalizeCount(metrics['reactionCount']);
      const reacted = !reactionSnapshot.exists;
      const nextCount = reacted
        ? Math.min(currentCount + 1, 1_000_000_000)
        : Math.max(0, currentCount - 1);
      const now = Date.now();
      const updatedAt = Timestamp.fromMillis(now);

      if (reacted) {
        transaction.create(reactionRef, { actorUid, createdAt: now });
        transaction.set(userReactionRef, {
          actorUid,
          communityId,
          postId,
          createdAt: now,
        });
      } else {
        transaction.delete(reactionRef);
        transaction.delete(userReactionRef);
      }
      transaction.update(postRef, {
        'metrics.reactionCount': nextCount,
        updatedAt,
      });
      transaction.update(projectionRef, {
        'metrics.reactionCount': nextCount,
        updatedAt,
      });

      return { communityId, postId, reacted, reactionCount: nextCount };
    });
  }
);
