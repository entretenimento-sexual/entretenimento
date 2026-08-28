// functions/src/community/respond-community-invite.handler.ts
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
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
import {
  evaluateCommunityInviteResponse,
  type CommunityInviteResponseAction,
} from './community-invite.policy';
import {
  assertCommunityInviteAuthenticatedUid,
  buildCommunityInviteId,
  COMMUNITY_INVITE_POLICY_VERSION,
  communityInviteToEpochMs,
  isCommunityInviteOperational,
  normalizeCommunityInviteMemberCount,
  normalizeCommunityInviteMembershipStatus,
  normalizeCommunityInviteStatus,
  requireCommunityInviteCanonicalPart,
  requireCommunityInviteId,
  resolveCommunityInviteCommunityId,
  type CommunityInviteDocument,
  type CommunityInviteResult,
} from './community-invite.shared';
import {
  assertCommunityMembershipActorEligible,
} from './community-membership-eligibility.service';

interface CommunityInviteResponseRequest {
  inviteId?: unknown;
}

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'Os convites de Comunidades ainda não estão disponíveis neste ambiente.'
  );
}

function throwDecisionError(reason: string | null): never {
  if (reason === 'invite_expired') {
    throw new HttpsError('failed-precondition', 'Este convite expirou.');
  }

  if (reason === 'membership_blocked') {
    throw new HttpsError(
      'permission-denied',
      'Você não pode participar desta Comunidade.'
    );
  }

  if (reason === 'community_unavailable') {
    throw new HttpsError(
      'failed-precondition',
      'Esta Comunidade não está disponível para entrada agora.'
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'Este convite não está mais disponível.'
  );
}

function validateInviteForReceiver(
  inviteId: string,
  invite: CommunityInviteDocument | undefined,
  receiverId: string
): { communityId: string; senderId: string } {
  if (!invite) {
    throw new HttpsError('not-found', 'Convite não encontrado.');
  }

  if (String(invite.type ?? '').trim() !== 'community') {
    throw new HttpsError(
      'failed-precondition',
      'Este convite não pertence a uma Comunidade.'
    );
  }

  if (String(invite.receiverId ?? '').trim() !== receiverId) {
    throw new HttpsError(
      'permission-denied',
      'Este convite não pertence à sua conta.'
    );
  }

  const communityId = resolveCommunityInviteCommunityId(invite);
  const senderId = requireCommunityInviteCanonicalPart(
    invite.senderId,
    'Convite sem remetente válido.'
  );

  if (inviteId !== buildCommunityInviteId(communityId, receiverId)) {
    throw new HttpsError(
      'failed-precondition',
      'Convite fora do contrato canônico.'
    );
  }

  return { communityId, senderId };
}

async function respondCommunityInvite(
  request: CallableRequest<CommunityInviteResponseRequest>,
  action: CommunityInviteResponseAction
): Promise<CommunityInviteResult> {
  const receiverId = assertCommunityInviteAuthenticatedUid(request.auth);
  const inviteId = requireCommunityInviteId(request.data?.inviteId);
  const inviteRef = db.collection('invites').doc(inviteId);
  const receiverUserRef = db.collection('users').doc(receiverId);
  const nowMs = Date.now();

  return db.runTransaction(async (transaction): Promise<CommunityInviteResult> => {
    const [inviteSnapshot, receiverUserSnapshot] = await Promise.all([
      transaction.get(inviteRef),
      transaction.get(receiverUserRef),
    ]);
    const invite = inviteSnapshot.data() as CommunityInviteDocument | undefined;
    const shape = validateInviteForReceiver(inviteId, invite, receiverId);
    const desiredStatus = action === 'accept' ? 'accepted' : 'declined';

    if (normalizeCommunityInviteStatus(invite?.status) === desiredStatus) {
      return {
        inviteId,
        communityId: shape.communityId,
        receiverId,
        status: desiredStatus,
        deduplicated: true,
      };
    }

    const communityRef = db.collection('communities').doc(shape.communityId);
    const membershipRef = communityRef.collection('members').doc(receiverId);
    const discoveryRef = db
      .collection('community_discovery_index')
      .doc(shape.communityId);
    const auditRef = db.collection('community_membership_audit').doc();
    const [
      communitySnapshot,
      membershipSnapshot,
      discoverySnapshot,
    ] = await Promise.all([
      transaction.get(communityRef),
      transaction.get(membershipRef),
      transaction.get(discoveryRef),
    ]);
    const community = communitySnapshot.exists
      ? communitySnapshot.data() ?? {}
      : null;
    const membership = membershipSnapshot.data() ?? {};
    const expiresAt = communityInviteToEpochMs(invite?.expiresAt);
    const decision = evaluateCommunityInviteResponse({
      action,
      inviteStatus: normalizeCommunityInviteStatus(invite?.status),
      inviteExpired: expiresAt === null || expiresAt <= nowMs,
      communityOperational:
        communitySnapshot.exists && isCommunityInviteOperational(community),
      targetStatus: normalizeCommunityInviteMembershipStatus(
        membership['status']
      ),
    });

    if (!decision.allowed || !decision.nextInviteStatus) {
      throwDecisionError(decision.denialReason);
    }

    if (action === 'accept') {
      assertCommunityMembershipActorEligible(
        receiverUserSnapshot.exists ? receiverUserSnapshot.data() : null,
        receiverId
      );
      await assertNoActiveBilateralBlockInTransaction(
        transaction,
        receiverId,
        shape.senderId,
        'Este convite não está mais disponível.'
      );

      if (!community) {
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }
    }

    if (decision.incrementMemberCount && community) {
      const capacity = await getCommunityCapacityForOwnerInTransaction(
        transaction,
        community,
        nowMs
      );
      assertCommunityAcceptingNewMembers(capacity);
    }

    const now = FieldValue.serverTimestamp();

    if (decision.activateMembership && community) {
      transaction.set(
        membershipRef,
        {
          communityId: shape.communityId,
          uid: receiverId,
          role: 'member',
          status: 'active',
          requestedAt: membership['requestedAt'] ?? null,
          joinedAt: now,
          leftAt: null,
          reviewedAt: now,
          reviewedBy: shape.senderId,
          requestResolution: 'invite_accepted',
          updatedAt: now,
          policyVersion: 1,
          source: 'community-invite',
        },
        { merge: true }
      );
    }

    if (decision.incrementMemberCount && community) {
      const currentMemberCount = normalizeCommunityInviteMemberCount(community);
      const nextMemberCount = currentMemberCount === null
        ? null
        : currentMemberCount + 1;
      const communityPatch: Record<string, unknown> = {
        'lifecycle.lastMeaningfulActivityAt': now,
        updatedAt: now,
      };

      if (nextMemberCount !== null) {
        communityPatch['metrics.memberCount'] = nextMemberCount;
      }

      transaction.update(communityRef, communityPatch);

      if (discoverySnapshot.exists && nextMemberCount !== null) {
        transaction.update(discoveryRef, {
          'metrics.memberCount': nextMemberCount,
          updatedAt: now,
        });
      }
    }

    transaction.update(inviteRef, {
      status: decision.nextInviteStatus,
      respondedAt: now,
      updatedAt: now,
    });
    transaction.set(auditRef, {
      action: action === 'accept'
        ? 'community-invite-accepted'
        : 'community-invite-declined',
      communityId: shape.communityId,
      inviteId,
      actorUid: receiverId,
      subjectUid: receiverId,
      senderUid: shape.senderId,
      createdAt: now,
      policyVersion: COMMUNITY_INVITE_POLICY_VERSION,
      source: 'callable',
    });

    return {
      inviteId,
      communityId: shape.communityId,
      receiverId,
      status: decision.nextInviteStatus,
      deduplicated: false,
    };
  });
}

export const acceptCommunityInvite = onCall<CommunityInviteResponseRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request) => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    return respondCommunityInvite(request, 'accept');
  }
);

export const declineCommunityInvite = onCall<CommunityInviteResponseRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request) => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    return respondCommunityInvite(request, 'decline');
  }
);
