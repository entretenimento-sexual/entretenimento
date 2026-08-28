// functions/src/community/get-community-invites.handler.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { resolveBlockedTargetUids } from '../friendship/application/bilateral-block-access.policy';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  assertCommunityInviteAuthenticatedUid,
  communityInviteToEpochMs,
  normalizeCommunityInviteText,
} from './community-invite.shared';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import { normalizeCommunityId } from './community-preview.model';

interface CommunityInviteInboxItem {
  inviteId: string;
  communityId: string;
  communityName: string;
  senderId: string;
  senderLabel: string;
  senderAvatarUrl: string | null;
  sentAt: number;
  expiresAt: number;
}

interface CommunityInviteInboxResponse {
  items: CommunityInviteInboxItem[];
  generatedAt: number;
}

const MAX_INVITES = 24;

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'Os convites de Comunidades ainda não estão disponíveis neste ambiente.'
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

export const getCommunityInvites = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityInviteInboxResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertPreviewRuntime();
    const uid = assertCommunityInviteAuthenticatedUid(request.auth);
    const userSnapshot = await db.collection('users').doc(uid).get();

    assertCommunityMembershipActorEligible(
      userSnapshot.exists ? userSnapshot.data() : null,
      uid
    );

    const invitesSnapshot = await db
      .collection('invites')
      .where('receiverId', '==', uid)
      .where('type', '==', 'community')
      .where('status', '==', 'pending')
      .limit(MAX_INVITES)
      .get();
    const now = Date.now();
    const candidates = invitesSnapshot.docs
      .map((document) => {
        const data = document.data();
        const communityId = normalizeCommunityId(
          data['targetId'] ?? data['communityId']
        );
        const senderId = normalizeCommunityInviteText(data['senderId'], 160);
        const sentAt = communityInviteToEpochMs(data['sentAt']);
        const expiresAt = communityInviteToEpochMs(data['expiresAt']);

        if (
          !communityId
          || !senderId
          || !sentAt
          || !expiresAt
          || expiresAt <= now
        ) {
          return null;
        }

        return {
          inviteId: document.id,
          communityId,
          communityName:
            normalizeCommunityInviteText(
              data['targetName'] ?? data['communityName'],
              80
            ) || 'Comunidade',
          senderId,
          sentAt,
          expiresAt,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const senderIds = [...new Set(candidates.map((item) => item.senderId))];
    const blockedSenderIds = await resolveBlockedTargetUids(uid, senderIds);
    const visibleCandidates = candidates.filter(
      (item) => !blockedSenderIds.has(item.senderId)
    );
    const visibleSenderIds = [
      ...new Set(visibleCandidates.map((item) => item.senderId)),
    ];
    const senderSnapshots = await Promise.all(
      visibleSenderIds.map((senderId) =>
        db.collection('users').doc(senderId).get()
      )
    );
    const senders = new Map(
      senderSnapshots.map((snapshot) => [snapshot.id, snapshot.data() ?? {}])
    );
    const items = visibleCandidates
      .map((item): CommunityInviteInboxItem => {
        const sender = senders.get(item.senderId) ?? {};

        return {
          ...item,
          senderLabel:
            normalizeCommunityInviteText(sender['nickname'], 60)
            || normalizeCommunityInviteText(sender['nome'], 60)
            || 'Participante',
          senderAvatarUrl: normalizeHttpsUrl(sender['photoURL']),
        };
      })
      .sort((left, right) => right.sentAt - left.sentAt);

    return { items, generatedAt: now };
  }
);
