// functions/src/community/sync-community-capacity-regularization.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY CAPACITY REGULARIZATION
// -----------------------------------------------------------------------------
// Reage somente às fontes que podem mudar o ciclo assinatura -> ownership ->
// capacidade. Escritas no próprio capacityRegularization não realimentam o
// trigger de Comunidade.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, Timestamp } from '../firebaseApp';
import {
  normalizeCommunityCapacityRegularizationState,
} from './community-capacity-regularization.policy';
import {
  reconcileCommunityCapacityRegularizationForOwner,
} from './community-capacity-regularization.service';
import {
  buildCommunityCapacityRegularizationNotificationCopy,
  buildCommunityCapacityRegularizationNotificationId,
  buildCommunityNotificationRoute,
} from './community-notification.policy';

const SAFE_UID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;

function cleanUid(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_UID_PATTERN.test(normalized) ? normalized : null;
}

function record(value: FirebaseFirestore.DocumentData | undefined) {
  return (value ?? {}) as Record<string, unknown>;
}

function communityRelevantSignature(
  value: FirebaseFirestore.DocumentData | undefined
): string {
  const source = record(value);
  const capacity = record(source['capacity'] as FirebaseFirestore.DocumentData);
  return JSON.stringify({
    ownerUid: source['ownerUid'] ?? null,
    status: source['status'] ?? null,
    sourceType: record(source['source'] as FirebaseFirestore.DocumentData)['type']
      ?? null,
    memberLimit: capacity['memberLimit'] ?? null,
  });
}

export const syncCommunityCapacityRegularizationFromEntitlement =
  onDocumentWritten(
    {
      document: 'entitlements/{entitlementId}',
      region: FUNCTIONS_REGION,
    },
    async (event) => {
      const entitlementId = String(event.params['entitlementId'] ?? '').trim();
      if (!entitlementId.startsWith('platform_subscription_')) return;

      const before = record(event.data?.before.data());
      const after = record(event.data?.after.data());
      const source = event.data?.after.exists ? after : before;
      const ownerUid = cleanUid(
        source['buyerUid']
        ?? entitlementId.slice('platform_subscription_'.length)
      );

      if (
        !ownerUid
        || (source['scope'] !== undefined
          && source['scope'] !== 'platform_subscription')
      ) {
        return;
      }

      await reconcileCommunityCapacityRegularizationForOwner(ownerUid);
    }
  );

export const syncCommunityCapacityRegularizationFromCommunity =
  onDocumentWritten(
    {
      document: 'communities/{communityId}',
      region: FUNCTIONS_REGION,
    },
    async (event) => {
      const before = event.data?.before.data();
      const after = event.data?.after.data();

      if (
        communityRelevantSignature(before)
        === communityRelevantSignature(after)
      ) {
        return;
      }

      const beforeRecord = record(before);
      const afterRecord = record(after);
      const afterStatus = String(afterRecord['status'] ?? '').trim();

      if (
        event.data?.after.exists
        && (afterStatus === 'archived'
          || afterStatus === 'scheduled_for_deletion')
        && afterRecord['capacityRegularization'] != null
      ) {
        await event.data.after.ref.set(
          {
            capacityRegularization: null,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      }

      const owners = new Set<string>();
      const beforeOwnerUid = cleanUid(beforeRecord['ownerUid']);
      const afterOwnerUid = cleanUid(afterRecord['ownerUid']);
      if (beforeOwnerUid) owners.add(beforeOwnerUid);
      if (afterOwnerUid) owners.add(afterOwnerUid);

      for (const ownerUid of owners) {
        await reconcileCommunityCapacityRegularizationForOwner(ownerUid);
      }
    }
  );


export const syncCommunityCapacityRegularizationAdminNotification =
  onDocumentWritten(
    {
      document: 'communities/{communityId}/members/{memberId}',
      region: FUNCTIONS_REGION,
    },
    async (event) => {
      const communityId = String(event.params['communityId'] ?? '').trim();
      const memberId = cleanUid(event.params['memberId']);
      if (!communityId || !memberId) return;

      const before = record(event.data?.before.data());
      const after = record(event.data?.after.data());
      const wasAdmin =
        before['status'] === 'active' && before['role'] === 'admin';
      const isAdmin =
        after['status'] === 'active' && after['role'] === 'admin';

      if (wasAdmin === isAdmin) return;

      const notificationRef = db.collection('notifications').doc(
        buildCommunityCapacityRegularizationNotificationId(
          communityId,
          memberId
        )
      );

      if (!isAdmin) {
        await notificationRef.set(
          {
            userId: memberId,
            type: 'community.capacity.regularization',
            actionRequired: false,
            readAt: Timestamp.now(),
            resolvedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          },
          { merge: true }
        );
        return;
      }

      const communitySnapshot = await db
        .collection('communities')
        .doc(communityId)
        .get();
      if (!communitySnapshot.exists) return;

      const community = communitySnapshot.data() ?? {};
      const regularization =
        normalizeCommunityCapacityRegularizationState(community);
      if (!regularization) return;

      const copy = buildCommunityCapacityRegularizationNotificationCopy({
        status: regularization.status,
        communityName: community['name'],
        deadlineAt: regularization.deadlineAt,
      });
      const now = Timestamp.now();

      await notificationRef.set(
        {
          userId: memberId,
          type: 'community.capacity.regularization',
          title: copy.title,
          body: copy.body,
          route: buildCommunityNotificationRoute(communityId),
          communityId,
          actorUid: regularization.ownerUid,
          actionRequired: true,
          regularizationStatus: regularization.status,
          regularizationDeadlineAt: regularization.deadlineAt,
          readAt: null,
          resolvedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }
  );
