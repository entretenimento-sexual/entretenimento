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
import {
  reconcileCommunityCapacityRegularizationForOwner,
} from './community-capacity-regularization.service';

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
