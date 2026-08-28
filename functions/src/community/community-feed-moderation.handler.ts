// -----------------------------------------------------------------------------
// COMMUNITY FEED POST ACTIONS
// -----------------------------------------------------------------------------
// Exclusão pelo autor e remoção pela gestão. A fonte operacional permanece como
// evidência mínima; a projeção legível é retirada na mesma transação.
// Fotos publicadas entram na fila de limpeza na mesma transação e recebem uma
// tentativa imediata de exclusão física somente depois que o commit confirma.
// -----------------------------------------------------------------------------

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, Timestamp } from '../firebaseApp';
import {
  deletePublishedPhotoAssetOrQueue,
  stagePublishedPhotoAssetCleanup,
  type StagedPublishedPhotoAssetCleanup,
} from '../media/application/published-photo-asset.service';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  CommunityFeedPostActionRequest,
  CommunityFeedPostActionResponse,
  CommunityFeedPostOperationalStatus,
  normalizeCommunityFeedPostActionRequest,
} from './community-feed-moderation.model';
import { evaluateCommunityFeedPostAction } from './community-feed-moderation.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  buildCommunityModerationNotificationCopy,
  buildCommunityModerationNotificationId,
  buildCommunityNotificationRoute,
  canReceiveCommunityEssentialNotification,
  type CommunityNotificationUser,
} from './community-notification.policy';
import type { CommunityViewerRole } from './community-preview.model';

interface PostActionTransactionResult {
  response: CommunityFeedPostActionResponse;
  cleanup: StagedPublishedPhotoAssetCleanup | null;
}

function assertFeedRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'As ações do Mural ainda não estão disponíveis neste ambiente.'
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
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

function normalizeStatus(value: unknown): CommunityFeedPostOperationalStatus | null {
  return value === 'active' || value === 'deleted' || value === 'removed'
    ? value
    : null;
}

function normalizeModerationState(value: unknown): 'active' | 'removed' | null {
  return value === 'active' || value === 'removed' ? value : null;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function throwDenied(reason: string | null): never {
  if (reason === 'post_author_required') {
    throw new HttpsError('permission-denied', 'Somente o autor pode excluir esta publicação.');
  }
  if (reason === 'active_management_required') {
    throw new HttpsError('permission-denied', 'A gestão ativa da Comunidade é necessária.');
  }
  if (reason === 'removal_reason_required') {
    throw new HttpsError('invalid-argument', 'Informe um motivo com pelo menos 3 caracteres.');
  }
  throw new HttpsError('failed-precondition', 'Esta publicação não permite a ação solicitada.');
}

function stagePostPhotoCleanup(
  transaction: FirebaseFirestore.Transaction,
  post: FirebaseFirestore.DocumentData,
  postId: string,
  action: 'delete_own' | 'remove'
): StagedPublishedPhotoAssetCleanup | null {
  if (post['kind'] !== 'photo') return null;

  const image = (post['image'] ?? {}) as Record<string, unknown>;
  const ownerUid = String(post['actorUid'] ?? '').trim();
  const storagePath = String(image['storagePath'] ?? '').trim();
  if (!ownerUid || !storagePath) return null;

  return stagePublishedPhotoAssetCleanup(transaction, {
    ownerUid,
    photoId: postId,
    storagePath,
    reason: action === 'delete_own'
      ? 'community-feed-post-deleted-by-author'
      : 'community-feed-post-removed-by-management',
  });
}

export const moderateCommunityFeedPost = onCall<CommunityFeedPostActionRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityFeedPostActionResponse> => {
    assertFeedRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityFeedPostActionRequest(request.data);

    if (
      !command.requestId
      || !command.communityId
      || !command.postId
      || !command.action
    ) {
      throw new HttpsError('invalid-argument', 'Ação de publicação inválida.');
    }
    if (command.reasonTooLong) {
      throw new HttpsError('invalid-argument', 'O motivo deve ter no máximo 240 caracteres.');
    }
    const action = command.action;

    const transactionResult = await db.runTransaction(async (transaction): Promise<PostActionTransactionResult> => {
      const communityId = command.communityId!;
      const postId = command.postId!;
      const requestId = command.requestId!;
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
      const discoveryRef = db.collection('community_discovery_index').doc(communityId);
      const requestRef = db.collection('community_feed_requests').doc(requestId);
      const auditRef = db.collection('community_feed_audit').doc(`action-${requestId}`);
      const actorActionRef = db
        .collection('community_feed_user_actions')
        .doc(actorUid)
        .collection('items')
        .doc(`${communityId}:${postId}`);

      const [
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        postSnapshot,
        projectionSnapshot,
        discoverySnapshot,
        requestSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(postRef),
        transaction.get(projectionRef),
        transaction.get(discoveryRef),
        transaction.get(requestRef),
      ]);

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        if (
          existing['actorUid'] !== actorUid
          || existing['kind'] !== 'post_action'
          || existing['communityId'] !== communityId
          || existing['postId'] !== postId
          || existing['action'] !== action
        ) {
          throw new HttpsError('already-exists', 'Este identificador já foi utilizado.');
        }
        const storedStatus = normalizeStatus(existing['status']);
        const completedAt = Number(existing['completedAt']);
        if (!storedStatus || !Number.isFinite(completedAt)) {
          throw new HttpsError('data-loss', 'O registro desta ação está inconsistente.');
        }
        const post = postSnapshot.exists ? postSnapshot.data() ?? {} : {};
        return {
          response: {
            communityId,
            postId,
            action,
            status: storedStatus,
            deduplicated: true,
            generatedAt: Math.trunc(completedAt),
          },
          cleanup: stagePostPhotoCleanup(transaction, post, postId, action),
        };
      }

      if (!communitySnapshot.exists) {
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }
      if (!postSnapshot.exists) {
        throw new HttpsError('not-found', 'Publicação não encontrada.');
      }

      assertCommunityMembershipActorEligible(
        userSnapshot.exists ? userSnapshot.data() : null,
        actorUid
      );

      const community = communitySnapshot.data() ?? {};
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const membership = membershipSnapshot.exists
        ? membershipSnapshot.data() ?? {}
        : {};
      const post = postSnapshot.data() ?? {};
      const actorRole = normalizeRole(membership['role']);
      const decision = evaluateCommunityFeedPostAction({
        action,
        sourceType: source['type'],
        actorUid,
        authorUid: String(post['actorUid'] ?? '').trim(),
        membershipStatus: membership['status'],
        viewerRole: actorRole,
        currentStatus: normalizeStatus(post['status']),
        currentModerationState: normalizeModerationState(post['moderationState']),
        reason: command.reason,
      });

      if (!decision.allowed || !decision.nextStatus || !decision.nextModerationState) {
        throwDenied(decision.denialReason);
      }
      if (!decision.idempotent && !projectionSnapshot.exists) {
        throw new HttpsError('data-loss', 'A projeção desta publicação está inconsistente.');
      }

      const nowMs = Date.now();
      const now = Timestamp.fromMillis(nowMs);
      const authorUid = String(post['actorUid'] ?? '').trim();
      let notificationRef: FirebaseFirestore.DocumentReference | null = null;

      if (
        action === 'remove'
        && !decision.idempotent
        && authorUid
        && authorUid !== actorUid
      ) {
        const authorUserSnapshot = await transaction.get(
          db.collection('users').doc(authorUid)
        );
        const authorUser = authorUserSnapshot.data() as
          | CommunityNotificationUser
          | undefined;

        if (canReceiveCommunityEssentialNotification(
          authorUser,
          authorUid,
          actorUid
        )) {
          notificationRef = db.collection('notifications').doc(
            buildCommunityModerationNotificationId(
              'post',
              requestId,
              authorUid
            )
          );
        }
      }

      const cleanup = stagePostPhotoCleanup(transaction, post, postId, action);

      if (!decision.idempotent) {
        transaction.update(postRef, {
          status: decision.nextStatus,
          moderationState: decision.nextModerationState,
          actionedAt: now,
          actionedBy: actorUid,
          actionReason: action === 'remove' ? command.reason : null,
          updatedAt: now,
        });
        transaction.delete(projectionRef);

        const communityMetrics = (community['metrics'] ?? {}) as Record<string, unknown>;
        const currentPostCount = normalizeCount(communityMetrics['postCount']);
        const currentMediaCount = normalizeCount(communityMetrics['mediaCount']);
        const photoPost = post['kind'] === 'photo';
        transaction.update(communityRef, {
          'metrics.postCount': Math.max(0, currentPostCount - 1),
          ...(photoPost
            ? { 'metrics.mediaCount': Math.max(0, currentMediaCount - 1) }
            : {}),
          updatedAt: nowMs,
        });
        if (discoverySnapshot.exists) {
          const discovery = discoverySnapshot.data() ?? {};
          const discoveryMetrics = (discovery['metrics'] ?? {}) as Record<string, unknown>;
          const discoveryPostCount = normalizeCount(discoveryMetrics['postCount']);
          const discoveryMediaCount = normalizeCount(discoveryMetrics['mediaCount']);
          transaction.update(discoveryRef, {
            'metrics.postCount': Math.max(0, discoveryPostCount - 1),
            ...(photoPost
              ? { 'metrics.mediaCount': Math.max(0, discoveryMediaCount - 1) }
              : {}),
            updatedAt: nowMs,
          });
        }

        transaction.create(auditRef, {
          action: action === 'delete_own'
            ? 'community-feed-post-deleted-by-author'
            : 'community-feed-post-removed-by-management',
          actorUid,
          actorRole,
          communityId,
          postId,
          reason: action === 'remove' ? command.reason : null,
          createdAt: nowMs,
          source: 'callable',
        });
        transaction.create(actorActionRef, {
          actorUid,
          communityId,
          postId,
          createdAt: nowMs,
        });
        if (notificationRef) {
          const copy = buildCommunityModerationNotificationCopy({
            target: 'post',
            communityName: community['name'],
          });
          transaction.set(notificationRef, {
            userId: authorUid,
            type: 'community.content.moderated',
            title: copy.title,
            body: copy.body,
            route: buildCommunityNotificationRoute(communityId),
            communityId,
            postId,
            moderationTarget: 'post',
            actorUid,
            readAt: null,
            createdAt: now,
            updatedAt: now,
          }, { merge: true });
        }
      }

      transaction.create(requestRef, {
        requestId,
        kind: 'post_action',
        actorUid,
        actorRole,
        communityId,
        postId,
        action,
        status: decision.nextStatus,
        idempotent: decision.idempotent,
        completedAt: nowMs,
        createdAt: nowMs,
      });

      return {
        response: {
          communityId,
          postId,
          action,
          status: decision.nextStatus,
          deduplicated: decision.idempotent,
          generatedAt: nowMs,
        },
        cleanup,
      };
    });

    if (transactionResult.cleanup) {
      try {
        await deletePublishedPhotoAssetOrQueue(transactionResult.cleanup);
      } catch (error) {
        logger.error('[communityFeed] Limpeza imediata da foto falhou; job transacional preservado.', {
          communityId: transactionResult.response.communityId,
          postId: transactionResult.response.postId,
          error: error instanceof Error ? error.message.slice(0, 300) : String(error),
        });
      }
    }

    return transactionResult.response;
  }
);
