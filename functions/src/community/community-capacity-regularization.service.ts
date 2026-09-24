// functions/src/community/community-capacity-regularization.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAPACITY REGULARIZATION SERVICE
// -----------------------------------------------------------------------------
// Materializa a governança derivada de entitlement + ownership. A fonte de
// verdade financeira continua em entitlements; este estado existe para prazo,
// comunicação, enforcement de admissão e auditoria. Nunca transfere ownership.
// -----------------------------------------------------------------------------

import { db } from '../firebaseApp';
import {
  evaluatePlatformSubscriptionEntitlement,
} from '../payments/application/platform-subscription-entitlement.service';
import {
  resolveCommunityCapacitySponsorRole,
  resolveCommunityOwnerPlanLimit,
  resolvePersonalCommunityCreationPolicy,
} from './community-capacity.policy';
import {
  evaluateCommunityCapacityRegularization,
  normalizeCommunityCapacityRegularizationState,
  type CommunityCapacityRegularizationState,
} from './community-capacity-regularization.policy';
import {
  buildCommunityCapacityRegularizationNotificationCopy,
  buildCommunityCapacityRegularizationNotificationId,
  buildCommunityNotificationRoute,
} from './community-notification.policy';

const SAFE_UID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;

function regularizationKey(
  value: Readonly<CommunityCapacityRegularizationState> | null
): string {
  if (!value) return 'none';
  return [
    value.status,
    value.ownerUid,
    value.reasons.join(','),
    value.sponsorRole,
    value.currentOwnedCommunities,
    value.maxOwnedCommunities ?? 'unlimited',
    value.configuredMemberLimit,
    value.planMemberLimit,
    value.startedAt,
    value.deadlineAt,
  ].join('|');
}

async function reconcileCommunityRegularizationDocument(input: {
  readonly communityId: string;
  readonly ownerUid: string;
  readonly sponsorRole: ReturnType<typeof resolveCommunityCapacitySponsorRole>;
  readonly currentOwnedCommunities: number;
  readonly maxOwnedCommunities: number | null;
  readonly planMemberLimit: ReturnType<typeof resolveCommunityOwnerPlanLimit>;
  readonly now: number;
}): Promise<void> {
  const communityRef = db.collection('communities').doc(input.communityId);
  const auditRef = db.collection('community_capacity_regularization_audit').doc();

  await db.runTransaction(async (transaction) => {
    const adminQuery = communityRef
      .collection('members')
      .where('status', '==', 'active')
      .where('role', '==', 'admin');

    const [communitySnapshot, adminSnapshot] = await Promise.all([
      transaction.get(communityRef),
      transaction.get(adminQuery),
    ]);

    if (!communitySnapshot.exists) return;

    const community = communitySnapshot.data() ?? {};
    const ownerUid = String(community['ownerUid'] ?? '').trim();
    const source = (community['source'] ?? {}) as Record<string, unknown>;
    const status = String(community['status'] ?? '').trim();

    if (
      ownerUid !== input.ownerUid
      || source['type'] !== 'community'
      || !['active', 'paused', 'dormant'].includes(status)
    ) {
      return;
    }

    const before = normalizeCommunityCapacityRegularizationState(community);
    const after = evaluateCommunityCapacityRegularization({
      rawCommunity: community,
      ownerUid: input.ownerUid,
      sponsorRole: input.sponsorRole,
      currentOwnedCommunities: input.currentOwnedCommunities,
      maxOwnedCommunities: input.maxOwnedCommunities,
      planMemberLimit: input.planMemberLimit,
      now: input.now,
    });
    const changed = regularizationKey(before) !== regularizationKey(after);

    if (!after) {
      if (!before) return;

      transaction.set(
        communityRef,
        {
          capacityRegularization: null,
          updatedAt: input.now,
        },
        { merge: true }
      );

      const recipients = new Set<string>([
        input.ownerUid,
        ...adminSnapshot.docs.map((document) => document.id),
      ]);

      for (const recipientUid of recipients) {
        const notificationRef = db.collection('notifications').doc(
          buildCommunityCapacityRegularizationNotificationId(
            input.communityId,
            recipientUid
          )
        );
        transaction.set(
          notificationRef,
          {
            userId: recipientUid,
            type: 'community.capacity.regularization',
            title: 'Regularização concluída',
            body: 'A Comunidade voltou a estar compatível com a capacidade da conta proprietária.',
            route: buildCommunityNotificationRoute(input.communityId),
            communityId: input.communityId,
            actorUid: input.ownerUid,
            actionRequired: false,
            readAt: input.now,
            resolvedAt: input.now,
            updatedAt: input.now,
          },
          { merge: true }
        );
      }

      transaction.create(auditRef, {
        action: 'community_capacity_regularization_resolved',
        communityId: input.communityId,
        ownerUid: input.ownerUid,
        previousStatus: before.status,
        previousReasons: before.reasons,
        createdAt: input.now,
        source: 'canonical-reconciliation',
      });
      return;
    }

    transaction.set(
      communityRef,
      {
        capacityRegularization: after,
        updatedAt: input.now,
      },
      { merge: true }
    );

    if (!changed) return;

    const copy = buildCommunityCapacityRegularizationNotificationCopy({
      status: after.status,
      communityName: community['name'],
      deadlineAt: after.deadlineAt,
    });
    const recipients = new Set<string>([
      input.ownerUid,
      ...adminSnapshot.docs.map((document) => document.id),
    ]);

    for (const recipientUid of recipients) {
      const notificationRef = db.collection('notifications').doc(
        buildCommunityCapacityRegularizationNotificationId(
          input.communityId,
          recipientUid
        )
      );
      transaction.set(
        notificationRef,
        {
          userId: recipientUid,
          type: 'community.capacity.regularization',
          title: copy.title,
          body: copy.body,
          route: buildCommunityNotificationRoute(input.communityId),
          communityId: input.communityId,
          actorUid: input.ownerUid,
          actionRequired: true,
          regularizationStatus: after.status,
          regularizationDeadlineAt: after.deadlineAt,
          readAt: null,
          resolvedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        },
        { merge: true }
      );
    }

    transaction.create(auditRef, {
      action: before
        ? 'community_capacity_regularization_updated'
        : 'community_capacity_regularization_started',
      communityId: input.communityId,
      ownerUid: input.ownerUid,
      previousStatus: before?.status ?? null,
      nextStatus: after.status,
      reasons: after.reasons,
      sponsorRole: after.sponsorRole,
      currentOwnedCommunities: after.currentOwnedCommunities,
      maxOwnedCommunities: after.maxOwnedCommunities,
      configuredMemberLimit: after.configuredMemberLimit,
      planMemberLimit: after.planMemberLimit,
      startedAt: after.startedAt,
      deadlineAt: after.deadlineAt,
      createdAt: input.now,
      source: 'canonical-reconciliation',
    });
  });
}

export async function reconcileCommunityCapacityRegularizationForOwner(
  ownerUid: string,
  now = Date.now()
): Promise<void> {
  const normalizedOwnerUid = String(ownerUid ?? '').trim();
  if (!SAFE_UID_PATTERN.test(normalizedOwnerUid)) return;

  const userRef = db.collection('users').doc(normalizedOwnerUid);
  const entitlementRef = db
    .collection('entitlements')
    .doc(`platform_subscription_${normalizedOwnerUid}`);
  const ownedQuery = db
    .collection('communities')
    .where('ownerUid', '==', normalizedOwnerUid)
    .where('source.type', '==', 'community')
    .where('status', 'in', ['active', 'paused', 'dormant']);

  const [userSnapshot, entitlementSnapshot, ownedSnapshot] = await Promise.all([
    userRef.get(),
    entitlementRef.get(),
    ownedQuery.get(),
  ]);

  if (!userSnapshot.exists && ownedSnapshot.empty) return;

  const user = userSnapshot.exists ? userSnapshot.data() ?? {} : {};
  const entitlement = evaluatePlatformSubscriptionEntitlement(
    entitlementSnapshot.exists ? entitlementSnapshot.data() : null,
    normalizedOwnerUid,
    now
  );
  const sponsorRole = resolveCommunityCapacitySponsorRole(
    entitlement.active ? entitlement.role : null,
    user['role']
  );
  const creationPolicy = resolvePersonalCommunityCreationPolicy(sponsorRole);
  const planMemberLimit = resolveCommunityOwnerPlanLimit(sponsorRole);

  for (const document of ownedSnapshot.docs) {
    await reconcileCommunityRegularizationDocument({
      communityId: document.id,
      ownerUid: normalizedOwnerUid,
      sponsorRole,
      currentOwnedCommunities: ownedSnapshot.size,
      maxOwnedCommunities: creationPolicy.maxOwnedCommunities,
      planMemberLimit,
      now,
    });
  }
}
