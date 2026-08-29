// functions/src/community/revoke-community-invite.handler.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import { evaluateCommunityInviteRevoke } from './community-invite.policy';
import {
  assertCommunityInviteAuthenticatedUid,
  buildCommunityInviteId,
  COMMUNITY_INVITE_POLICY_VERSION,
  normalizeCommunityInviteMembershipRole,
  normalizeCommunityInviteMembershipStatus,
  normalizeCommunityInviteStatus,
  requireCommunityInviteCanonicalPart,
  requireCommunityInviteId,
  resolveCommunityInviteCommunityId,
  resolveCommunityMembersCanInvite,
  type CommunityInviteDocument,
  type CommunityInviteResult,
} from './community-invite.shared';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';

interface RevokeCommunityInviteRequest {
  inviteId?: unknown;
}

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'Os convites de Comunidades ainda não estão disponíveis neste ambiente.',
    { reason: 'community_invites_unavailable' }
  );
}

function throwDecisionError(reason: string | null): never {
  if (reason === 'inviter_not_allowed') {
    throw new HttpsError(
      'permission-denied',
      'Você não pode revogar este convite.',
      { reason }
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'Este convite não está mais pendente.',
    { reason: reason ?? 'invite_not_pending' }
  );
}

export const revokeCommunityInvite = onCall<RevokeCommunityInviteRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityInviteResult> => {
    assertCommunityCallableAppCheck(request.app);
    assertPreviewRuntime();
    const actorUid = assertCommunityInviteAuthenticatedUid(request.auth);
    const inviteId = requireCommunityInviteId(request.data?.inviteId);
    const inviteRef = db.collection('invites').doc(inviteId);
    const actorUserRef = db.collection('users').doc(actorUid);

    return db.runTransaction(async (transaction): Promise<CommunityInviteResult> => {
      const [inviteSnapshot, actorUserSnapshot] = await Promise.all([
        transaction.get(inviteRef),
        transaction.get(actorUserRef),
      ]);
      const invite = inviteSnapshot.data() as CommunityInviteDocument | undefined;

      if (!invite) {
        throw new HttpsError(
          'not-found',
          'Convite não encontrado.',
          { reason: 'invite_not_found' }
        );
      }

      if (String(invite.type ?? '').trim() !== 'community') {
        throw new HttpsError(
          'failed-precondition',
          'Este convite não pertence a uma Comunidade.',
          { reason: 'invite_contract_invalid' }
        );
      }

      const communityId = resolveCommunityInviteCommunityId(invite);
      const receiverId = requireCommunityInviteCanonicalPart(
        invite.receiverId,
        'Convite sem destinatário válido.'
      );
      const senderId = requireCommunityInviteCanonicalPart(
        invite.senderId,
        'Convite sem remetente válido.'
      );

      if (inviteId !== buildCommunityInviteId(communityId, receiverId)) {
        throw new HttpsError(
          'failed-precondition',
          'Convite fora do contrato canônico.',
          { reason: 'invite_contract_invalid' }
        );
      }

      const actorIsOriginalSender = senderId === actorUid;
      const communityRef = db.collection('communities').doc(communityId);
      const actorMembershipRef = communityRef.collection('members').doc(actorUid);
      const [communitySnapshot, actorMembershipSnapshot] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(actorMembershipRef),
      ]);
      const community = communitySnapshot.exists
        ? communitySnapshot.data() ?? {}
        : {};
      const actorMembership = actorMembershipSnapshot.data() ?? {};

      if (!actorIsOriginalSender) {
        assertCommunityMembershipActorEligible(
          actorUserSnapshot.exists ? actorUserSnapshot.data() : null,
          actorUid
        );
      }

      const decision = evaluateCommunityInviteRevoke({
        actorStatus: normalizeCommunityInviteMembershipStatus(
          actorMembership['status']
        ),
        actorRole: normalizeCommunityInviteMembershipRole(actorMembership['role']),
        membersCanInvite: resolveCommunityMembersCanInvite(community),
        actorIsOriginalSender,
        inviteStatus: normalizeCommunityInviteStatus(invite.status),
      });

      if (!decision.allowed) {
        throwDecisionError(decision.denialReason);
      }

      if (decision.deduplicated) {
        return {
          inviteId,
          communityId,
          receiverId,
          status: 'revoked',
          deduplicated: true,
        };
      }

      const now = FieldValue.serverTimestamp();
      transaction.update(inviteRef, {
        status: 'revoked',
        respondedAt: now,
        updatedAt: now,
      });
      transaction.set(db.collection('community_membership_audit').doc(), {
        action: 'community-invite-revoked',
        communityId,
        inviteId,
        actorUid,
        subjectUid: receiverId,
        senderUid: senderId,
        createdAt: now,
        policyVersion: COMMUNITY_INVITE_POLICY_VERSION,
        source: 'callable',
      });

      return {
        inviteId,
        communityId,
        receiverId,
        status: 'revoked',
        deduplicated: false,
      };
    });
  }
);
