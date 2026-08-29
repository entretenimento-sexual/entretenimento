// functions/src/community/community-invite-management.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY INVITE MANAGEMENT
// -----------------------------------------------------------------------------
// Busca exata por nickname evita enumeração de perfis. Listagem e busca são
// sanitizadas; envio e revogação continuam em callables transacionais próprias.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { resolveBlockedTargetUids } from '../friendship/application/bilateral-block-access.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import { getCommunityCapacityForOwner } from './community-capacity.service';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  canSendCommunityInvite,
} from './community-invite.policy';
import {
  assertCommunityInviteAuthenticatedUid,
  buildCommunityInviteId,
  communityInviteToEpochMs,
  isCommunityInviteOperational,
  normalizeCommunityInviteMembershipRole,
  normalizeCommunityInviteMembershipStatus,
  normalizeCommunityInviteStatus,
  normalizeCommunityInviteText,
  resolveCommunityMembersCanInvite,
} from './community-invite.shared';
import {
  CommunityInviteCandidateRequest,
  CommunityInviteCandidateResponse,
  CommunityInviteManagementRequest,
  CommunitySentInviteItem,
  CommunitySentInvitesResponse,
  normalizeCommunityInviteCandidateRequest,
  normalizeCommunityInviteManagementRequest,
} from './community-invite-management.model';
import {
  assertCommunityMembershipActorEligible,
} from './community-membership-eligibility.service';
import type {
  CommunityMembershipRole,
  CommunityMembershipStatus,
} from './community-membership-request.policy';

interface InviteActorContext {
  community: Record<string, unknown>;
  actorRole: CommunityMembershipRole;
}

const MAX_SENT_INVITES = 24;

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A gestão de convites ainda não está disponível neste ambiente.',
    { reason: 'community_invites_unavailable' }
  );
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeCommunityInviteText(value, 2_000);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function isManagementRole(role: CommunityMembershipRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}

function isEligibleUser(raw: unknown, uid: string): boolean {
  try {
    assertCommunityMembershipActorEligible(raw, uid);
    return true;
  } catch {
    return false;
  }
}

async function requireInviteActor(
  actorUid: string,
  communityId: string
): Promise<InviteActorContext> {
  const communityRef = db.collection('communities').doc(communityId);
  const [communitySnapshot, membershipSnapshot, userSnapshot] =
    await Promise.all([
      communityRef.get(),
      communityRef.collection('members').doc(actorUid).get(),
      db.collection('users').doc(actorUid).get(),
    ]);

  if (!communitySnapshot.exists) {
    throw new HttpsError(
      'not-found',
      'Comunidade não encontrada.',
      { reason: 'community_not_found' }
    );
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
  const actorStatus = normalizeCommunityInviteMembershipStatus(
    membership['status']
  );
  const actorRole = normalizeCommunityInviteMembershipRole(membership['role']);

  if (
    source['type'] !== 'community'
    || !actorRole
    || !isCommunityInviteOperational(community)
    || !canSendCommunityInvite(
      actorStatus,
      actorRole,
      resolveCommunityMembersCanInvite(community)
    )
  ) {
    throw new HttpsError(
      'permission-denied',
      'Você não pode gerenciar convites desta Comunidade.',
      { reason: 'invite_management_forbidden' }
    );
  }

  return { community, actorRole };
}

export const findCommunityInviteCandidate =
  onCall<CommunityInviteCandidateRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityInviteCandidateResponse> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertCommunityInviteAuthenticatedUid(request.auth);
      const command = normalizeCommunityInviteCandidateRequest(request.data);

      if (!command) {
        throw new HttpsError(
          'invalid-argument',
          'Informe o apelido exato de um perfil.',
          { reason: 'invalid_invite_candidate_query' }
        );
      }

      const actorContextPromise = requireInviteActor(
        actorUid,
        command.communityId
      );
      const indexSnapshotPromise = db
        .collection('public_index')
        .doc(`nickname:${command.nicknameNormalized}`)
        .get();
      const [actorContext, indexSnapshot] = await Promise.all([
        actorContextPromise,
        indexSnapshotPromise,
      ]);
      const generatedAt = Date.now();
      const index = indexSnapshot.exists ? indexSnapshot.data() ?? {} : {};
      const candidateUid = normalizeCommunityInviteText(index['uid'], 160);

      if (
        index['type'] !== 'nickname'
        || index['value'] !== command.nicknameNormalized
        || !candidateUid
        || candidateUid === actorUid
        || candidateUid.includes(':')
        || candidateUid.includes('/')
      ) {
        return { candidate: null, generatedAt };
      }

      const candidateMembershipRef = db
        .collection('communities')
        .doc(command.communityId)
        .collection('members')
        .doc(candidateUid);
      const [
        profileSnapshot,
        userSnapshot,
        membershipSnapshot,
        inviteSnapshot,
        blockedUids,
      ] = await Promise.all([
        db.collection('public_profiles').doc(candidateUid).get(),
        db.collection('users').doc(candidateUid).get(),
        candidateMembershipRef.get(),
        db.collection('invites')
          .doc(buildCommunityInviteId(command.communityId, candidateUid))
          .get(),
        resolveBlockedTargetUids(actorUid, [candidateUid]),
      ]);

      if (
        !profileSnapshot.exists
        || blockedUids.has(candidateUid)
        || !isEligibleUser(
          userSnapshot.exists ? userSnapshot.data() : null,
          candidateUid
        )
      ) {
        return { candidate: null, generatedAt };
      }

      const profile = profileSnapshot.data() ?? {};
      const nickname = normalizeCommunityInviteText(profile['nickname'], 60);
      if (!nickname) return { candidate: null, generatedAt };

      const membership = membershipSnapshot.exists
        ? membershipSnapshot.data() ?? {}
        : {};
      const membershipStatus: CommunityMembershipStatus | null =
        normalizeCommunityInviteMembershipStatus(membership['status']);
      const invite = inviteSnapshot.exists ? inviteSnapshot.data() ?? {} : {};
      const inviteStatus = normalizeCommunityInviteStatus(invite['status']);
      const inviteExpiresAt = communityInviteToEpochMs(invite['expiresAt']);
      const capacity = await getCommunityCapacityForOwner(
        actorContext.community,
        generatedAt
      );
      const status = membershipStatus === 'active'
        ? 'already_member'
        : inviteStatus === 'pending'
          && inviteExpiresAt !== null
          && inviteExpiresAt > generatedAt
          ? 'invite_pending'
          : capacity?.acceptingNewMembers === true
            ? 'eligible'
            : 'access_unavailable';

      if (membershipStatus === 'blocked') {
        return { candidate: null, generatedAt };
      }

      return {
        candidate: {
          userId: candidateUid,
          nickname,
          avatarUrl: normalizeHttpsUrl(
            profile['avatarUrl'] ?? profile['photoURL']
          ),
          status,
        },
        generatedAt,
      };
    }
  );

export const getCommunitySentInvites = onCall<CommunityInviteManagementRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunitySentInvitesResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertCommunityInviteAuthenticatedUid(request.auth);
    const communityId = normalizeCommunityInviteManagementRequest(request.data);

    if (!communityId) {
      throw new HttpsError(
        'invalid-argument',
        'Comunidade inválida.',
        { reason: 'invalid_community_id' }
      );
    }

    const actorContext = await requireInviteActor(actorUid, communityId);
    let sentInvitesQuery = db
      .collection('invites')
      .where('communityId', '==', communityId)
      .where('type', '==', 'community')
      .where('status', '==', 'pending');

    if (!isManagementRole(actorContext.actorRole)) {
      sentInvitesQuery = sentInvitesQuery.where('senderId', '==', actorUid);
    }

    const snapshot = await sentInvitesQuery
      .orderBy('sentAt', 'desc')
      .limit(MAX_SENT_INVITES * 2)
      .get();
    const generatedAt = Date.now();
    const candidates = snapshot.docs
      .map((document) => {
        const invite = document.data();
        const receiverId = normalizeCommunityInviteText(
          invite['receiverId'],
          160
        );
        const senderId = normalizeCommunityInviteText(invite['senderId'], 160);
        const sentAt = communityInviteToEpochMs(invite['sentAt']);
        const expiresAt = communityInviteToEpochMs(invite['expiresAt']);

        if (
          !receiverId
          || !senderId
          || !sentAt
          || !expiresAt
          || expiresAt <= generatedAt
        ) {
          return null;
        }

        return {
          inviteId: document.id,
          receiverId,
          senderId,
          sentAt,
          expiresAt,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const profileIds = [...new Set(candidates.flatMap(
      (item) => [item.receiverId, item.senderId]
    ))];
    const profileSnapshots = profileIds.length > 0
      ? await db.getAll(...profileIds.map(
        (uid) => db.collection('public_profiles').doc(uid)
      ))
      : [];
    const profiles = new Map(
      profileSnapshots.map((profile) => [profile.id, profile.data() ?? {}])
    );
    const items = candidates
      .map((item): CommunitySentInviteItem => {
        const receiver = profiles.get(item.receiverId) ?? {};
        const sender = profiles.get(item.senderId) ?? {};

        return {
          ...item,
          receiverLabel:
            normalizeCommunityInviteText(receiver['nickname'], 60)
            || 'Perfil convidado',
          receiverAvatarUrl: normalizeHttpsUrl(
            receiver['avatarUrl'] ?? receiver['photoURL']
          ),
          senderLabel: item.senderId === actorUid
            ? 'Você'
            : normalizeCommunityInviteText(sender['nickname'], 60)
              || 'Participante',
        };
      })
      .sort((left, right) => right.sentAt - left.sentAt)
      .slice(0, MAX_SENT_INVITES);

    return { items, generatedAt };
  }
);
