// functions/src/community/community-topic-write.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPIC WRITES
// -----------------------------------------------------------------------------
// Criação de Tópicos e Respostas exclusivamente pelo backend.
// Mantém estado operacional separado da projeção sanitizada e revalida conta,
// membership e estado comunitário dentro da transação.
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
import {
  assertCommunityMembershipActorEligible,
} from './community-membership-eligibility.service';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import {
  CommunityTopicCreateRequest,
  CommunityTopicReplyCreateRequest,
  CommunityTopicReplyWriteResponse,
  CommunityTopicWriteResponse,
  normalizeCommunityTopicCreateRequest,
  normalizeCommunityTopicReplyCreateRequest,
} from './community-topic.model';
import {
  evaluateCommunityTopicRateWindow,
  resolveCommunityTopicAudience,
  resolveCommunityTopicWriteLimit,
} from './community-topic-write.policy';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'Os Tópicos de Comunidades ainda não estão disponíveis neste ambiente.'
  );
}

function assertAuthenticatedUid(
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

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeSafeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeHttpsUrl(value: unknown): string | null {
  const text = normalizeSafeText(value, 2_000);
  if (!text) return null;

  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildAuthor(rawUser: unknown): {
  label: string;
  avatarUrl: string | null;
} {
  const user = (rawUser ?? {}) as Record<string, unknown>;
  const label = normalizeSafeText(user['nickname'], 60)
    || normalizeSafeText(user['nome'], 60)
    || 'Participante';

  return {
    label,
    avatarUrl:
      normalizeHttpsUrl(user['photoURL'])
      ?? normalizeHttpsUrl(user['photoUrl'])
      ?? normalizeHttpsUrl(user['avatarUrl']),
  };
}

function assertTransactionalInteractionAllowed(
  rawCommunity: unknown,
  rawMembership: unknown,
  rawUser: unknown,
  uid: string
): void {
  assertCommunityMembershipActorEligible(rawUser, uid);

  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
  const membership = (rawMembership ?? {}) as Record<string, unknown>;

  if (
    !isCommunityMemberActivityEnabledStatus(community['status'])
    || moderation['state'] !== 'active'
    || membership['status'] !== 'active'
  ) {
    throw new HttpsError(
      'permission-denied',
      'Você não pode interagir com esta Comunidade agora.'
    );
  }
}

function throwRateLimit(): never {
  throw new HttpsError(
    'resource-exhausted',
    'Você atingiu o limite temporário de interações em Tópicos. Tente novamente mais tarde.',
    {
      reason: 'community_topic_rate_limited',
      recommendedAction: 'retry_later',
    }
  );
}

export const createCommunityTopic = onCall<CommunityTopicCreateRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityTopicWriteResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityTopicCreateRequest(request.data);

    if (
      !command.requestId
      || !command.communityId
      || !command.title
      || !command.body
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Revise o título e o texto do Tópico.'
      );
    }

    const topicBody = command.body;
    const viewerContext = await getCommunityViewerContext(
      actorUid,
      command.communityId
    );
    if (!viewerContext.canInteract) {
      throw new HttpsError(
        'permission-denied',
        'Participe da Comunidade para criar Tópicos.'
      );
    }

    await consumeCommunityRateLimit({
      action: 'topic_conversation',
      actorUid,
    });

    const nowMs = Date.now();
    const topicId = command.requestId;

    return db.runTransaction(async (transaction): Promise<CommunityTopicWriteResponse> => {
      const communityRef = db.collection('communities').doc(command.communityId!);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const configRef = db.collection('platform_config').doc('community');
      const requestRef = db.collection('community_topic_requests').doc(command.requestId!);
      const userStateRef = db.collection('community_topic_user_state').doc(actorUid);
      const topicRef = db
        .collection('community_topics')
        .doc(command.communityId!)
        .collection('items')
        .doc(topicId);
      const projectionRef = db
        .collection('community_public_topics')
        .doc(command.communityId!)
        .collection('items')
        .doc(topicId);
      const auditRef = db
        .collection('community_topic_audit')
        .doc(`topic-${command.requestId}`);

      const [
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        configSnapshot,
        requestSnapshot,
        userStateSnapshot,
        topicSnapshot,
        projectionSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(configRef),
        transaction.get(requestRef),
        transaction.get(userStateRef),
        transaction.get(topicRef),
        transaction.get(projectionRef),
      ]);

      if (!communitySnapshot.exists) {
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        if (
          existing['actorUid'] !== actorUid
          || existing['kind'] !== 'topic'
          || existing['communityId'] !== command.communityId
          || existing['topicId'] !== topicId
        ) {
          throw new HttpsError(
            'already-exists',
            'Este identificador de requisição já foi utilizado.'
          );
        }

        return {
          communityId: command.communityId!,
          topicId,
          created: false,
          deduplicated: true,
        };
      }

      assertTransactionalInteractionAllowed(
        communitySnapshot.data(),
        membershipSnapshot.exists ? membershipSnapshot.data() : null,
        userSnapshot.exists ? userSnapshot.data() : null,
        actorUid
      );

      if (topicSnapshot.exists || projectionSnapshot.exists) {
        throw new HttpsError(
          'already-exists',
          'Este Tópico já existe.'
        );
      }

      const config = configSnapshot.exists ? configSnapshot.data() : null;
      const limit = resolveCommunityTopicWriteLimit(config, 'topic');
      const rateDecision = evaluateCommunityTopicRateWindow(
        userStateSnapshot.exists ? userStateSnapshot.data() : null,
        'topic',
        nowMs,
        limit
      );
      if (!rateDecision.allowed) throwRateLimit();

      const community = communitySnapshot.data() ?? {};
      const communityMetrics = (community['metrics'] ?? {}) as Record<string, unknown>;
      const nextTopicCount = normalizeCount(communityMetrics['topicCount']) + 1;
      const effectiveAudience = resolveCommunityTopicAudience(
        community['visibility']
      );
      const author = buildAuthor(userSnapshot.data());
      const now = Timestamp.fromMillis(nowMs);
      const excerpt = topicBody.slice(0, 320);

      transaction.create(topicRef, {
        topicId,
        communityId: command.communityId,
        title: command.title,
        body: topicBody,
        audience: effectiveAudience,
        status: 'active',
        moderationState: 'active',
        actorUid,
        author,
        metrics: {
          replyCount: 0,
          reactionCount: 0,
        },
        createdAt: now,
        lastActivityAt: now,
        updatedAt: now,
        source: 'callable',
      });

      transaction.create(projectionRef, {
        title: command.title,
        excerpt,
        audience: effectiveAudience,
        status: 'active',
        moderationState: 'active',
        author,
        metrics: {
          replyCount: 0,
          reactionCount: 0,
        },
        createdAt: now,
        lastActivityAt: now,
      });

      transaction.set(
        userStateRef,
        {
          topicWindowStartedAt: rateDecision.windowStartedAt,
          topicWritesInWindow: rateDecision.nextCount,
          updatedAt: nowMs,
        },
        { merge: true }
      );
      transaction.create(requestRef, {
        requestId: command.requestId,
        kind: 'topic',
        actorUid,
        communityId: command.communityId,
        topicId,
        createdAt: nowMs,
      });
      transaction.create(auditRef, {
        action: 'community-topic-created',
        actorUid,
        communityId: command.communityId,
        topicId,
        createdAt: nowMs,
      });
      transaction.update(communityRef, {
        'metrics.topicCount': nextTopicCount,
        'lifecycle.lastMeaningfulActivityAt': nowMs,
        updatedAt: nowMs,
      });

      return {
        communityId: command.communityId!,
        topicId,
        created: true,
        deduplicated: false,
      };
    });
  }
);

export const createCommunityTopicReply = onCall<CommunityTopicReplyCreateRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityTopicReplyWriteResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityTopicReplyCreateRequest(request.data);

    if (
      !command.requestId
      || !command.communityId
      || !command.topicId
      || !command.body
    ) {
      throw new HttpsError('invalid-argument', 'Revise a resposta ao Tópico.');
    }

    const replyBody = command.body;
    const viewerContext = await getCommunityViewerContext(
      actorUid,
      command.communityId
    );
    if (!viewerContext.canInteract) {
      throw new HttpsError(
        'permission-denied',
        'Participe da Comunidade para responder aos Tópicos.'
      );
    }

    await consumeCommunityRateLimit({
      action: 'topic_conversation',
      actorUid,
    });

    const nowMs = Date.now();
    const replyId = command.requestId;

    return db.runTransaction(async (transaction): Promise<CommunityTopicReplyWriteResponse> => {
      const communityRef = db.collection('communities').doc(command.communityId!);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const configRef = db.collection('platform_config').doc('community');
      const requestRef = db.collection('community_topic_requests').doc(command.requestId!);
      const userStateRef = db.collection('community_topic_user_state').doc(actorUid);
      const topicRef = db
        .collection('community_topics')
        .doc(command.communityId!)
        .collection('items')
        .doc(command.topicId!);
      const projectionRef = db
        .collection('community_public_topics')
        .doc(command.communityId!)
        .collection('items')
        .doc(command.topicId!);
      const replyRef = topicRef.collection('replies').doc(replyId);
      const publicReplyRef = projectionRef.collection('replies').doc(replyId);
      const auditRef = db
        .collection('community_topic_audit')
        .doc(`reply-${command.requestId}`);

      const [
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        configSnapshot,
        requestSnapshot,
        userStateSnapshot,
        topicSnapshot,
        projectionSnapshot,
        replySnapshot,
        publicReplySnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(configRef),
        transaction.get(requestRef),
        transaction.get(userStateRef),
        transaction.get(topicRef),
        transaction.get(projectionRef),
        transaction.get(replyRef),
        transaction.get(publicReplyRef),
      ]);

      if (!communitySnapshot.exists) {
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        if (
          existing['actorUid'] !== actorUid
          || existing['kind'] !== 'reply'
          || existing['communityId'] !== command.communityId
          || existing['topicId'] !== command.topicId
          || existing['replyId'] !== replyId
        ) {
          throw new HttpsError(
            'already-exists',
            'Este identificador de requisição já foi utilizado.'
          );
        }

        return {
          communityId: command.communityId!,
          topicId: command.topicId!,
          replyId,
          replyCount: normalizeCount(existing['replyCount']),
          created: false,
          deduplicated: true,
        };
      }

      assertTransactionalInteractionAllowed(
        communitySnapshot.data(),
        membershipSnapshot.exists ? membershipSnapshot.data() : null,
        userSnapshot.exists ? userSnapshot.data() : null,
        actorUid
      );

      if (!topicSnapshot.exists || !projectionSnapshot.exists) {
        throw new HttpsError('not-found', 'Tópico não encontrado.');
      }

      const topic = topicSnapshot.data() ?? {};
      if (
        topic['status'] !== 'active'
        || topic['moderationState'] !== 'active'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Este Tópico não aceita novas respostas.'
        );
      }

      if (replySnapshot.exists || publicReplySnapshot.exists) {
        throw new HttpsError('already-exists', 'Esta resposta já existe.');
      }

      const config = configSnapshot.exists ? configSnapshot.data() : null;
      const limit = resolveCommunityTopicWriteLimit(config, 'reply');
      const rateDecision = evaluateCommunityTopicRateWindow(
        userStateSnapshot.exists ? userStateSnapshot.data() : null,
        'reply',
        nowMs,
        limit
      );
      if (!rateDecision.allowed) throwRateLimit();

      const author = buildAuthor(userSnapshot.data());
      const now = Timestamp.fromMillis(nowMs);
      const metrics = (topic['metrics'] ?? {}) as Record<string, unknown>;
      const nextReplyCount = normalizeCount(metrics['replyCount']) + 1;

      transaction.create(replyRef, {
        replyId,
        communityId: command.communityId,
        topicId: command.topicId,
        body: replyBody,
        actorUid,
        author,
        moderationState: 'active',
        createdAt: now,
        updatedAt: now,
        source: 'callable',
      });
      transaction.create(publicReplyRef, {
        body: replyBody,
        author,
        moderationState: 'active',
        createdAt: now,
      });
      transaction.update(topicRef, {
        'metrics.replyCount': nextReplyCount,
        lastActivityAt: now,
        updatedAt: now,
      });
      transaction.update(projectionRef, {
        'metrics.replyCount': nextReplyCount,
        lastActivityAt: now,
      });
      transaction.set(
        userStateRef,
        {
          replyWindowStartedAt: rateDecision.windowStartedAt,
          replyWritesInWindow: rateDecision.nextCount,
          updatedAt: nowMs,
        },
        { merge: true }
      );
      transaction.create(requestRef, {
        requestId: command.requestId,
        kind: 'reply',
        actorUid,
        communityId: command.communityId,
        topicId: command.topicId,
        replyId,
        replyCount: nextReplyCount,
        createdAt: nowMs,
      });
      transaction.create(auditRef, {
        action: 'community-topic-replied',
        actorUid,
        communityId: command.communityId,
        topicId: command.topicId,
        replyId,
        createdAt: nowMs,
      });
      transaction.update(communityRef, {
        'lifecycle.lastMeaningfulActivityAt': nowMs,
        updatedAt: nowMs,
      });

      return {
        communityId: command.communityId!,
        topicId: command.topicId!,
        replyId,
        replyCount: nextReplyCount,
        created: true,
        deduplicated: false,
      };
    });
  }
);
