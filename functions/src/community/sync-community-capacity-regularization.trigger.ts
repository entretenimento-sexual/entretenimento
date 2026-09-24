// functions/src/community/sync-community-capacity-regularization.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY CAPACITY REGULARIZATION
// -----------------------------------------------------------------------------
// Materializa a governança assinatura -> propriedade -> capacidade.
// O entitlement continua sendo a fonte de verdade; este documento é apenas
// estado operacional para UX, prazo e auditoria. Não remove membros, não
// transfere ownership e não arquiva automaticamente.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  evaluatePlatformSubscriptionEntitlement,
} from '../payments/application/platform-subscription-entitlement.service';
import {
  evaluateCommunityCapacity,
  MAX_PERSONAL_COMMUNITIES_PER_OWNER,
  resolveCommunityCapacitySponsorRole,
  resolvePersonalCommunityCreationPolicy,
} from './community-capacity.policy';
import {
  buildCommunityCapacityRegularization,
} from './community-capacity-regularization.policy';

const PLATFORM_ENTITLEMENT_PREFIX = 'platform_subscription_';
const LEGACY_OWNERSHIP_SCAN_HEADROOM = 8;
const MAX_ADMIN_NOTIFICATIONS_PER_COMMUNITY = 10;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,160}$/.test(normalized) ? normalized : null;
}

function buyerUidFromEvent(input: {
  entitlementId: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
}): string | null {
  const payloadUid = cleanId(
    input.afterData?.['buyerUid'] ?? input.beforeData?.['buyerUid']
  );
  if (payloadUid) return payloadUid;

  return input.entitlementId.startsWith(PLATFORM_ENTITLEMENT_PREFIX)
    ? cleanId(input.entitlementId.slice(PLATFORM_ENTITLEMENT_PREFIX.length))
    : null;
}

function notificationId(
  communityId: string,
  recipientUid: string,
  startedAt: number
): string {
  return `community_capacity_${createHash('sha256')
    .update([communityId, recipientUid, startedAt].join('|'))
    .digest('hex')
    .slice(0, 40)}`;
}

async function notifyRegularizationAudience(input: {
  communityId: string;
  communityName: string;
  ownerUid: string;
  startedAt: number;
  dueAt: number;
}): Promise<void> {
  const members = await db
    .collection('communities')
    .doc(input.communityId)
    .collection('members')
    .where('role', '==', 'admin')
    .limit(MAX_ADMIN_NOTIFICATIONS_PER_COMMUNITY)
    .get();
  const recipientUids = new Set<string>([input.ownerUid]);

  for (const member of members.docs) {
    if (member.data()?.['status'] === 'active') {
      const uid = cleanId(member.id);
      if (uid) recipientUids.add(uid);
    }
  }

  const batch = db.batch();
  for (const recipientUid of recipientUids) {
    const id = notificationId(
      input.communityId,
      recipientUid,
      input.startedAt
    );
    batch.set(db.collection('notifications').doc(id), {
      userId: recipientUid,
      type: 'system',
      title: 'Comunidade precisa de regularização',
      body: [
        input.communityName
          ? `A Comunidade ${input.communityName} entrou em regularização.`
          : 'Uma Comunidade que você administra entrou em regularização.',
        'O proprietário pode regularizar o plano, transferir a propriedade',
        'ou arquivar a Comunidade. Os membros atuais são preservados.',
      ].join(' '),
      route: `/dashboard/comunidades/minhas/${input.communityId}`,
      actionRequired: true,
      pushMode: 'IN_APP_ONLY',
      communityId: input.communityId,
      responseDueAt: input.dueAt,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false });
  }
  await batch.commit();
}

export const syncCommunityCapacityRegularization = onDocumentWritten(
  {
    document: 'entitlements/{entitlementId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const entitlementId = String(event.params.entitlementId ?? '').trim();
    const beforeData = event.data?.before.exists
      ? event.data.before.data() as Record<string, unknown>
      : null;
    const afterData = event.data?.after.exists
      ? event.data.after.data() as Record<string, unknown>
      : null;
    const scope = String(
      afterData?.['scope'] ?? beforeData?.['scope'] ?? ''
    ).trim();

    if (
      !entitlementId.startsWith(PLATFORM_ENTITLEMENT_PREFIX)
      && scope !== 'platform_subscription'
    ) {
      return;
    }

    const ownerUid = buyerUidFromEvent({
      entitlementId,
      beforeData,
      afterData,
    });
    if (!ownerUid) return;

    const [userSnapshot, communitiesSnapshot] = await Promise.all([
      db.collection('users').doc(ownerUid).get(),
      db.collection('communities')
        .where('ownerUid', '==', ownerUid)
        .where('source.type', '==', 'community')
        .where('status', 'in', ['active', 'paused', 'dormant'])
        .limit(MAX_PERSONAL_COMMUNITIES_PER_OWNER + LEGACY_OWNERSHIP_SCAN_HEADROOM)
        .get(),
    ]);

    if (communitiesSnapshot.empty) return;

    const now = Date.now();
    const entitlement = evaluatePlatformSubscriptionEntitlement(
      afterData,
      ownerUid,
      now
    );
    const user = userSnapshot.exists ? userSnapshot.data() ?? {} : {};
    const sponsorRole = resolveCommunityCapacitySponsorRole(
      entitlement.active ? entitlement.role : null,
      user['role']
    );
    const ownershipPolicy = resolvePersonalCommunityCreationPolicy(sponsorRole);
    const ownershipOverPlan = ownershipPolicy.maxOwnedCommunities !== null
      && communitiesSnapshot.size > ownershipPolicy.maxOwnedCommunities;
    const started: Array<{
      communityId: string;
      communityName: string;
      startedAt: number;
      dueAt: number;
    }> = [];

    const batch = db.batch();
    for (const document of communitiesSnapshot.docs) {
      const community = document.data() ?? {};
      const capacity = evaluateCommunityCapacity({
        rawCommunity: community,
        sponsorRole,
      });
      const next = buildCommunityCapacityRegularization({
        rawExisting: community['capacityRegularization'],
        capacity,
        ownerUid,
        ...(ownershipOverPlan && !capacity.regularizationRequired
          ? { reasonOverride: 'ownership_over_plan' as const }
          : {}),
        now,
      });

      if (!next) {
        if (community['capacityRegularization'] !== undefined) {
          batch.update(document.ref, {
            capacityRegularization: FieldValue.delete(),
            updatedAt: now,
          });
        }
        continue;
      }

      const previous = community['capacityRegularization'] as
        | Record<string, unknown>
        | undefined;
      batch.update(document.ref, {
        capacityRegularization: next,
        updatedAt: now,
      });

      if (
        previous?.['state'] !== 'capacity_regularization'
        || previous?.['startedAt'] !== next.startedAt
      ) {
        started.push({
          communityId: document.id,
          communityName: String(community['name'] ?? '').trim().slice(0, 80),
          startedAt: next.startedAt,
          dueAt: next.dueAt,
        });
      }
    }

    await batch.commit();

    await Promise.all(started.map((item) =>
      notifyRegularizationAudience({
        ...item,
        ownerUid,
      })
    ));
  }
);
