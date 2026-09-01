// functions/src/community/community-topic-moderation.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPIC MODERATION
// -----------------------------------------------------------------------------
// Moderação autoritativa de Tópicos por owner/admin/moderator ativos.
// Lock/unlock atualizam fonte e projeção. Remove preserva a fonte operacional
// como evidência (archived/removed) e retira a projeção pública imediatamente.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, Timestamp } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { isCommunityMemberActivityEnabledStatus } from './community-lifecycle.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { canViewerModerateCommunityTopic } from './community-topic-access.policy';
import {
  CommunityTopicModerationAction,
  CommunityTopicModerationRequest,
  CommunityTopicModerationResponse,
  CommunityTopicModerationState,
  evaluateCommunityTopicModerationTransition,
  normalizeCommunityTopicModerationRequest,
} from './community-topic-moderation.model';
import type { CommunityTopicStatus } from './community-topic.model';
import type { CommunityViewerRole } from './community-preview.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertTopicsRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A moderação de Tópicos ainda não está disponível neste ambiente.',
    { reason: 'community_topic_moderation_unavailable' }
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

function normalizeViewerRole(value: unknown): CommunityViewerRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeTopicStatus(value: unknown): CommunityTopicStatus | null {
  return value === 'active' || value === 'locked' || value === 'archived'
    ? value
    : null;
}

function normalizeModerationState(
  value: unknown
): CommunityTopicModerationState | null {
  return value === 'active' || value === 'removed' ? value : null;
}

function assertTransactionalModerator(
  rawCommunity: unknown,
  rawMembership: unknown,
  rawUser: unknown,
  actorUid: string
): CommunityViewerRole {
  assertCommunityMembershipActorEligible(rawUser, actorUid);

  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const role = normalizeViewerRole(membership['role']);

  if (
    !isCommunityMemberActivityEnabledStatus(community['status'])
    || moderation['state'] !== 'active'
    || membership['status'] !== 'active'
    || !canViewerModerateCommunityTopic(role)
  ) {
    throw new HttpsError(
      'permission-denied',
      'Você não possui permissão para moderar Tópicos nesta Comunidade.',
      { reason: 'topic_moderation_forbidden' }
    );
  }

  return role;
}

function throwTransitionError(reason: string | null): never {
  if (reason === 'removal_reason_required') {
    throw new HttpsError(
      'invalid-argument',
      'Informe um motivo com pelo menos 3 caracteres para remover o Tópico.',
      { reason }
    );
  }

  if (reason === 'removed_topic') {
    throw new HttpsError(
      'failed-precondition',
      'Um Tópico removido não pode ser reaberto.',
      { reason }
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'O estado atual deste Tópico não permite esta ação.',
    { reason: reason ?? 'topic_transition_forbidden' }
  );
}

function auditAction(action: CommunityTopicModerationAction): string {
  if (action === 'lock') return 'community-topic-locked';
  if (action === 'unlock') return 'community-topic-unlocked';
  return 'community-topic-removed';
}

export const moderateCommunityTopic = onCall<CommunityTopicModerationRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityTopicModerationResponse> => {
    assertTopicsRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityTopicModerationRequest(request.data);

    if (
      !command.requestId
      || !command.communityId
      || !command.topicId
      || !command.action
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Ação de moderação inválida.',
        { reason: 'invalid_topic_moderation_action' }
      );
    }

    if (command.reasonTooLong) {
      throw new HttpsError(
        'invalid-argument',
        'O motivo da moderação deve ter no máximo 240 caracteres.',
        { reason: 'removal_reason_too_long' }
      );
    }

    const context = await getCommunityViewerContext(actorUid, command.communityId);
    if (
      !context.memberActivityAllowed
      || !canViewerModerateCommunityTopic(context.viewerRole)
    ) {
      throw new HttpsError(
        'permission-denied',
        'Você não possui permissão para moderar Tópicos nesta Comunidade.',
        { reason: 'topic_moderation_forbidden' }
      );
    }

    await consumeCommunityRateLimit({
      action: 'content_moderation',
      actorUid,
    });

    const communityId = command.communityId;
    const topicId = command.topicId;
    const requestId = command.requestId;
    const action = command.action;

    return db.runTransaction(async (transaction): Promise<CommunityTopicModerationResponse> => {
      const communityRef = db.collection('communities').doc(communityId);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const topicRef = db
        .collection('community_topics')
        .doc(communityId)
        .collection('items')
        .doc(topicId);
      const projectionRef = db
        .collection('community_public_topics')
        .doc(communityId)
        .collection('items')
        .doc(topicId);
      const requestRef = db.collection('community_topic_requests').doc(requestId);
      const auditRef = db
        .collection('community_topic_audit')
        .doc(`moderation-${requestId}`);

      const [
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        topicSnapshot,
        projectionSnapshot,
        requestSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(topicRef),
        transaction.get(projectionRef),
        transaction.get(requestRef),
      ]);

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        if (
          existing['actorUid'] !== actorUid
          || existing['kind'] !== 'moderation'
          || existing['communityId'] !== communityId
          || existing['topicId'] !== topicId
          || existing['action'] !== action
        ) {
          throw new HttpsError(
            'already-exists',
            'Este identificador de requisição já foi utilizado.',
            { reason: 'request_id_conflict' }
          );
        }

        const storedStatus = normalizeTopicStatus(existing['status']);
        const storedModerationState = normalizeModerationState(
          existing['moderationState']
        );
        const completedAt = Number(existing['completedAt']);

        if (
          !storedStatus
          || !storedModerationState
          || !Number.isFinite(completedAt)
        ) {
          throw new HttpsError(
            'data-loss',
            'O registro idempotente desta moderação está inconsistente.',
            { reason: 'moderation_record_inconsistent' }
          );
        }

        return {
          communityId,
          topicId,
          action,
          status: storedStatus,
          moderationState: storedModerationState,
          deduplicated: true,
          generatedAt: Math.trunc(completedAt),
        };
      }

      if (!communitySnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Comunidade não encontrada.',
          { reason: 'community_not_found' }
        );
      }

      if (!topicSnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Tópico não encontrado.',
          { reason: 'topic_not_found' }
        );
      }

      const actorRole = assertTransactionalModerator(
        communitySnapshot.data(),
        membershipSnapshot.exists ? membershipSnapshot.data() : null,
        userSnapshot.exists ? userSnapshot.data() : null,
        actorUid
      );
      const topic = topicSnapshot.data() ?? {};
      const currentStatus = normalizeTopicStatus(topic['status']);
      const currentModerationState = normalizeModerationState(topic['moderationState']);
      const transition = evaluateCommunityTopicModerationTransition({
        action,
        currentStatus,
        currentModerationState,
        reason: command.reason,
      });

      if (
        !transition.allowed
        || !transition.nextStatus
        || !transition.nextModerationState
      ) {
        throwTransitionError(transition.denialReason);
      }

      if (!transition.deleteProjection && !projectionSnapshot.exists) {
        throw new HttpsError(
          'data-loss',
          'A projeção deste Tópico está inconsistente e exige revisão.',
          { reason: 'topic_projection_inconsistent' }
        );
      }

      const nowMs = Date.now();
      const now = Timestamp.fromMillis(nowMs);

      if (!transition.idempotent) {
        transaction.update(topicRef, {
          status: transition.nextStatus,
          moderationState: transition.nextModerationState,
          moderatedAt: now,
          moderatedBy: actorUid,
          moderationReason: command.reason,
          updatedAt: now,
        });

        if (transition.deleteProjection) {
          transaction.delete(projectionRef);
        } else {
          transaction.update(projectionRef, {
            status: transition.nextStatus,
            moderationState: transition.nextModerationState,
          });
        }

        transaction.create(auditRef, {
          action: auditAction(action),
          actorUid,
          actorRole,
          communityId,
          topicId,
          previousStatus: currentStatus,
          nextStatus: transition.nextStatus,
          previousModerationState: currentModerationState,
          nextModerationState: transition.nextModerationState,
          reason: command.reason,
          createdAt: nowMs,
          source: 'callable',
        });
      }

      transaction.create(requestRef, {
        requestId,
        kind: 'moderation',
        actorUid,
        actorRole,
        communityId,
        topicId,
        action,
        status: transition.nextStatus,
        moderationState: transition.nextModerationState,
        idempotent: transition.idempotent,
        completedAt: nowMs,
        createdAt: nowMs,
      });

      return {
        communityId,
        topicId,
        action,
        status: transition.nextStatus,
        moderationState: transition.nextModerationState,
        deduplicated: transition.idempotent,
        generatedAt: nowMs,
      };
    });
  }
);
