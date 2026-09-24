// functions/src/community/community-capacity-regularization.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAPACITY REGULARIZATION SERVICE
// -----------------------------------------------------------------------------
// Reconcilia o estado operacional assinatura -> ownership -> capacidade usando
// apenas fontes canônicas do backend. Pode ser chamado por mudanças de
// entitlement e imediatamente após mutações explícitas de ownership.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

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

const LEGACY_OWNERSHIP_SCAN_HEADROOM = 8;
const MAX_ADMIN_NOTIFICATIONS_PER_COMMUNITY = 10;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,160}$/.test(normalized) ? normalized : null;
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

  if (recipientUids.size === 0) return;

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
      route: `/dashboard/comunidades/minhas/${input.communityId}?secao=gestao`,
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

export interface CommunityCapacityRegularizationReconciliation {
  readonly ownerUid: string;
  readonly inspectedCommunities: number;
  readonly regularizedCommunities: number;
  readonly clearedCommunities: number;
  readonly ownershipOverPlan: boolean;
}

export async function reconcilePersonalCommunityCapacityRegularization(
  input: {
    readonly ownerUid: string;
    readonly rawEntitlement?: unknown;
    readonly now?: number;
  }
): Promise<Readonly<CommunityCapacityRegularizationReconciliation>> {
  const ownerUid = cleanId(input.ownerUid);
  if (!ownerUid) {
    throw new Error('Owner inválido para reconciliação de capacidade.');
  }

  const now = Number.isFinite(input.now)
    ? Math.trunc(input.now as number)
    : Date.now();
  const entitlementRef = db
    .collection('entitlements')
    .doc(`platform_subscription_${ownerUid}`);
  const entitlementPromise = input.rawEntitlement === undefined
    ? entitlementRef.get()
    : Promise.resolve(null);
  const [userSnapshot, communitiesSnapshot, entitlementSnapshot] =
    await Promise.all([
      db.collection('users').doc(ownerUid).get(),
      db.collection('communities')
        .where('ownerUid', '==', ownerUid)
        .where('source.type', '==', 'community')
        .where('status', 'in', ['active', 'paused', 'dormant'])
        .limit(MAX_PERSONAL_COMMUNITIES_PER_OWNER + LEGACY_OWNERSHIP_SCAN_HEADROOM)
        .get(),
      entitlementPromise,
    ]);

  if (communitiesSnapshot.empty) {
    return Object.freeze({
      ownerUid,
      inspectedCommunities: 0,
      regularizedCommunities: 0,
      clearedCommunities: 0,
      ownershipOverPlan: false,
    });
  }

  const rawEntitlement = input.rawEntitlement === undefined
    ? entitlementSnapshot?.exists
      ? entitlementSnapshot.data()
      : null
    : input.rawEntitlement;
  const entitlement = evaluatePlatformSubscriptionEntitlement(
    rawEntitlement,
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
  let regularizedCommunities = 0;
  let clearedCommunities = 0;
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
        clearedCommunities += 1;
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
    regularizedCommunities += 1;

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

  return Object.freeze({
    ownerUid,
    inspectedCommunities: communitiesSnapshot.size,
    regularizedCommunities,
    clearedCommunities,
    ownershipOverPlan,
  });
}
