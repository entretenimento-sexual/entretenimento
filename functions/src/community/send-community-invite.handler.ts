// functions/src/community/send-community-invite.handler.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue, Timestamp } from '../firebaseApp';
import { assertNoActiveBilateralBlockInTransaction } from '../friendship/application/bilateral-block-access.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunityAcceptingNewMembers,
  getCommunityCapacityForOwnerInTransaction,
} from './community-capacity.service';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import { evaluateCommunityInviteSend } from './community-invite.policy';
import {
  assertCommunityInviteAuthenticatedUid,
  buildCommunityInviteId,
  buildCommunityInviteNotificationId,
  COMMUNITY_INVITE_POLICY_VERSION,
  COMMUNITY_INVITE_TTL_MS,
  communityInviteToEpochMs,
  isCommunityInviteOperational,
  normalizeCommunityInviteMembershipRole,
  normalizeCommunityInviteMembershipStatus,
  normalizeCommunityInviteStatus,
  normalizeCommunityInviteText,
  requireCommunityInviteCanonicalPart,
  resolveCommunityMembersCanInvite,
  type CommunityInviteDocument,
  type CommunityInviteResult,
} from './community-invite.shared';
import {
  assertCommunityMembershipActorEligible,
} from './community-membership-eligibility.service';
import { normalizeCommunityId } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';

interface SendCommunityInviteRequest {
  communityId?: unknown;
  receiverId?: unknown;
}

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'Os convites de Comunidades ainda não estão disponíveis neste ambiente.',
    { reason: 'community_invites_unavailable' }
  );
}

function throwSendDecisionError(reason: string | null): never {
  if (reason === 'inviter_not_allowed') {
    throw new HttpsError(
      'permission-denied',
      'Você não pode enviar convites para esta Comunidade.',
      { reason }
    );
  }

  if (reason === 'target_already_member') {
    throw new HttpsError(
      'already-exists',
      'Este perfil já participa da Comunidade.',
      { reason }
    );
  }

  if (reason === 'target_blocked') {
    throw new HttpsError(
      'permission-denied',
      'Este vínculo não pode receber convites.',
      { reason }
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'Esta Comunidade não aceita convites agora.',
    { reason: reason ?? 'community_unavailable' }
  );
}

export const sendCommunityInvite = onCall<SendCommunityInviteRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityInviteResult> => {
    assertCommunityCallableAppCheck(request.app);
    assertPreviewRuntime();
    const actorUid = assertCommunityInviteAuthenticatedUid(request.auth);
    const communityId = normalizeCommunityId(request.data?.communityId);
    const receiverId = requireCommunityInviteCanonicalPart(
      request.data?.receiverId,
      'Destinatário inválido para convite.'
    );

    if (!communityId) {
      throw new HttpsError(
        'invalid-argument',
        'Comunidade inválida.',
        { reason: 'invalid_community_id' }
      );
    }

    if (actorUid === receiverId) {
      throw new HttpsError(
        'invalid-argument',
        'Você não pode enviar convite para si mesmo.',
        { reason: 'self_invite_forbidden' }
      );
    }

    await consumeCommunityRateLimit({
      action: 'invite_send',
      actorUid,
    });

    const inviteId = buildCommunityInviteId(communityId, receiverId);
    const nowMs = Date.now();

    return db.runTransaction(async (transaction): Promise<CommunityInviteResult> => {
      const communityRef = db.collection('communities').doc(communityId);
      const actorMembershipRef = communityRef.collection('members').doc(actorUid);
      const receiverMembershipRef = communityRef
        .collection('members')
        .doc(receiverId);
      const actorUserRef = db.collection('users').doc(actorUid);
      const receiverUserRef = db.collection('users').doc(receiverId);
      const inviteRef = db.collection('invites').doc(inviteId);
      const notificationRef = db
        .collection('notifications')
        .doc(buildCommunityInviteNotificationId(communityId, receiverId));
      const auditRef = db.collection('community_membership_audit').doc();

      const [
        communitySnapshot,
        actorMembershipSnapshot,
        receiverMembershipSnapshot,
        actorUserSnapshot,
        receiverUserSnapshot,
        inviteSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(actorMembershipRef),
        transaction.get(receiverMembershipRef),
        transaction.get(actorUserRef),
        transaction.get(receiverUserRef),
        transaction.get(inviteRef),
      ]);

      if (!communitySnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Comunidade não encontrada.',
          { reason: 'community_not_found' }
        );
      }

      assertCommunityMembershipActorEligible(
        actorUserSnapshot.exists ? actorUserSnapshot.data() : null,
        actorUid
      );
      assertCommunityMembershipActorEligible(
        receiverUserSnapshot.exists ? receiverUserSnapshot.data() : null,
        receiverId
      );
      await assertNoActiveBilateralBlockInTransaction(
        transaction,
        actorUid,
        receiverId,
        'Não foi possível enviar este convite.'
      );

      const community = communitySnapshot.data() ?? {};
      const actorMembership = actorMembershipSnapshot.data() ?? {};
      const receiverMembership = receiverMembershipSnapshot.data() ?? {};
      const existingInvite = inviteSnapshot.data() as
        | CommunityInviteDocument
        | undefined;
      const existingExpiresAt = communityInviteToEpochMs(existingInvite?.expiresAt);
      const decision = evaluateCommunityInviteSend({
        communityOperational: isCommunityInviteOperational(community),
        actorStatus: normalizeCommunityInviteMembershipStatus(
          actorMembership['status']
        ),
        actorRole: normalizeCommunityInviteMembershipRole(actorMembership['role']),
        membersCanInvite: resolveCommunityMembersCanInvite(community),
        targetStatus: normalizeCommunityInviteMembershipStatus(
          receiverMembership['status']
        ),
        existingInviteStatus: normalizeCommunityInviteStatus(
          existingInvite?.status
        ),
        existingInviteExpired:
          existingExpiresAt !== null && existingExpiresAt <= nowMs,
      });

      if (!decision.allowed) {
        throwSendDecisionError(decision.denialReason);
      }

      if (decision.deduplicated) {
        return {
          inviteId,
          communityId,
          receiverId,
          status: 'pending',
          deduplicated: true,
        };
      }

      const capacity = await getCommunityCapacityForOwnerInTransaction(
        transaction,
        community,
        nowMs
      );
      assertCommunityAcceptingNewMembers(capacity);

      const now = FieldValue.serverTimestamp();
      const expiresAt = Timestamp.fromMillis(nowMs + COMMUNITY_INVITE_TTL_MS);
      const communityName =
        normalizeCommunityInviteText(community['name'], 80) || 'Comunidade';
      const actorUser = actorUserSnapshot.data() ?? {};
      const actorLabel =
        normalizeCommunityInviteText(actorUser['nickname'], 60)
        || normalizeCommunityInviteText(actorUser['nome'], 60)
        || 'Um participante';

      transaction.set(inviteRef, {
        type: 'community',
        targetId: communityId,
        targetName: communityName,
        communityId,
        communityName,
        senderId: actorUid,
        receiverId,
        status: 'pending',
        sentAt: now,
        expiresAt,
        respondedAt: null,
        updatedAt: now,
        policyVersion: COMMUNITY_INVITE_POLICY_VERSION,
        source: 'callable',
      });

      transaction.set(
        notificationRef,
        {
          userId: receiverId,
          type: 'social',
          title: 'Convite para Comunidade',
          body: `${actorLabel} convidou você para ${communityName}.`,
          route: '/dashboard/comunidades/convites',
          inviteId,
          communityId,
          actorUid,
          readAt: null,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      transaction.set(auditRef, {
        action: 'community-invite-sent',
        communityId,
        inviteId,
        actorUid,
        subjectUid: receiverId,
        createdAt: now,
        policyVersion: COMMUNITY_INVITE_POLICY_VERSION,
        source: 'callable',
      });

      return {
        inviteId,
        communityId,
        receiverId,
        status: 'pending',
        deduplicated: false,
      };
    });
  }
);
