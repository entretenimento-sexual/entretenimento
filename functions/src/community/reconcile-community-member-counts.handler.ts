// functions/src/community/reconcile-community-member-counts.handler.ts
// -----------------------------------------------------------------------------
// RECONCILE COMMUNITY MEMBER COUNTS
// -----------------------------------------------------------------------------
// Manutenção administrativa explícita para auditar/reparar metrics.memberCount.
// Não substitui os deltas transacionais dos handlers de membership. O reparo
// deriva a ocupação dos documentos members/* dentro da própria transação e
// falha fechado quando encontra status de membership desconhecido.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  CommunityMemberCountProjectionState,
  evaluateCommunityMemberCountProjection,
  summarizeCommunityMembershipOccupancy,
} from './community-member-count-reconciliation.policy';

interface ReconcileCommunityMemberCountsRequest {
  limit?: unknown;
  dryRun?: unknown;
  startAfterCommunityId?: unknown;
}

interface CommunityMemberCountReconciliationItem {
  communityId: string;
  state: CommunityMemberCountProjectionState;
  projectedCount: number | null;
  activeCount: number;
  invalidStatusCount: number;
  discoveryProjectedCount: number | null;
  discoveryNeedsRepair: boolean;
  repaired: boolean;
}

interface ReconcileCommunityMemberCountsResponse {
  ok: true;
  dryRun: boolean;
  limit: number;
  startAfterCommunityId: string | null;
  nextCursor: string | null;
  hasMore: boolean;
  processed: number;
  consistent: number;
  drifted: number;
  invalidProjection: number;
  invalidMembershipState: number;
  repaired: number;
  missing: number;
  items: CommunityMemberCountReconciliationItem[];
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function hasReconciliationAccess(source: Record<string, unknown>): boolean {
  const primaryRole = String(source['role'] ?? '').trim().toLowerCase();
  const roles = new Set<string>([
    primaryRole,
    ...normalizeStringArray(source['staffRoles']),
    ...normalizeStringArray(source['roles']),
  ]);
  const permissions = new Set<string>(
    normalizeStringArray(source['permissions'])
  );

  return source['superadmin'] === true
    || source['admin'] === true
    || roles.has('superadmin')
    || roles.has('admin')
    || permissions.has('communities:reconcile');
}

async function assertReconciliationAuthorization(
  actorUid: string | null,
  authToken: Record<string, unknown>
): Promise<string> {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (hasReconciliationAccess(authToken)) return actorUid;

  const actorSnapshot = await db.collection('users').doc(actorUid).get();
  const actor = (actorSnapshot.data() ?? {}) as Record<string, unknown>;
  if (hasReconciliationAccess(actor)) return actorUid;

  throw new HttpsError(
    'permission-denied',
    'Usuário sem permissão para reconciliar contagem de participantes.'
  );
}

function normalizeLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
}

function normalizeCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 1_500) : null;
}

function readProjectedCount(rawDocument: unknown): unknown {
  const document = (rawDocument ?? {}) as Record<string, unknown>;
  const metrics = (document['metrics'] ?? {}) as Record<string, unknown>;
  return metrics['memberCount'];
}

export const reconcileCommunityMemberCounts =
  onCall<ReconcileCommunityMemberCountsRequest>(
    {
      region: FUNCTIONS_REGION,
      invoker: 'public',
    },
    async (request): Promise<ReconcileCommunityMemberCountsResponse> => {
      const actorUid = await assertReconciliationAuthorization(
        request.auth?.uid ?? null,
        (request.auth?.token ?? {}) as Record<string, unknown>
      );
      const limit = normalizeLimit(request.data?.limit);
      const dryRun = request.data?.dryRun !== false;
      const startAfterCommunityId = normalizeCursor(
        request.data?.startAfterCommunityId
      );

      let communitiesQuery = db
        .collection('communities')
        .orderBy(FieldPath.documentId());
      if (startAfterCommunityId) {
        communitiesQuery = communitiesQuery.startAfter(startAfterCommunityId);
      }

      const communitiesSnapshot = await communitiesQuery.limit(limit).get();
      const items: CommunityMemberCountReconciliationItem[] = [];
      let consistent = 0;
      let drifted = 0;
      let invalidProjection = 0;
      let invalidMembershipState = 0;
      let repaired = 0;
      let missing = 0;

      for (const communityDocument of communitiesSnapshot.docs) {
        const communityId = communityDocument.id;
        const communityRef = communityDocument.ref;
        const discoveryRef = db
          .collection('community_discovery_index')
          .doc(communityId);
        const membersQuery = communityRef.collection('members');

        const item = await db.runTransaction(
          async (transaction): Promise<CommunityMemberCountReconciliationItem | null> => {
            const [communitySnapshot, discoverySnapshot, membersSnapshot] =
              await Promise.all([
                transaction.get(communityRef),
                transaction.get(discoveryRef),
                transaction.get(membersQuery),
              ]);

            if (!communitySnapshot.exists) return null;

            const occupancy = summarizeCommunityMembershipOccupancy(
              membersSnapshot.docs.map((document) => document.data()?.['status'])
            );
            const communityDecision = evaluateCommunityMemberCountProjection(
              readProjectedCount(communitySnapshot.data()),
              occupancy
            );
            const discoveryDecision = discoverySnapshot.exists
              ? evaluateCommunityMemberCountProjection(
                  readProjectedCount(discoverySnapshot.data()),
                  occupancy
                )
              : null;
            const discoveryNeedsRepair =
              discoveryDecision?.needsRepair === true
              && discoveryDecision.repairable;
            const shouldRepair = communityDecision.repairable
              && (communityDecision.needsRepair || discoveryNeedsRepair);
            let didRepair = false;

            if (!dryRun && shouldRepair) {
              const now = Date.now();
              transaction.update(communityRef, {
                'metrics.memberCount': occupancy.activeCount,
                memberCountReconciledAt: now,
                memberCountReconciledBy: actorUid,
                updatedAt: now,
              });

              if (discoverySnapshot.exists && discoveryNeedsRepair) {
                transaction.update(discoveryRef, {
                  'metrics.memberCount': occupancy.activeCount,
                  memberCountReconciledAt: now,
                  updatedAt: now,
                });
              }

              const auditRef = db
                .collection('community_membership_audit')
                .doc();
              transaction.create(auditRef, {
                action: 'community_member_count_reconciled',
                communityId,
                actorUid,
                previousMemberCount: communityDecision.projectedCount,
                nextMemberCount: occupancy.activeCount,
                discoveryRepaired: discoveryNeedsRepair,
                createdAt: now,
                source: 'admin-reconciliation',
              });
              didRepair = true;
            }

            return {
              communityId,
              state: communityDecision.state,
              projectedCount: communityDecision.projectedCount,
              activeCount: occupancy.activeCount,
              invalidStatusCount: occupancy.invalidStatusCount,
              discoveryProjectedCount:
                discoveryDecision?.projectedCount ?? null,
              discoveryNeedsRepair,
              repaired: didRepair,
            };
          }
        );

        if (!item) {
          missing += 1;
          continue;
        }

        items.push(item);
        if (item.state === 'consistent') consistent += 1;
        if (item.state === 'drift') drifted += 1;
        if (item.state === 'projection_invalid') invalidProjection += 1;
        if (item.state === 'membership_state_invalid') {
          invalidMembershipState += 1;
        }
        if (item.repaired) repaired += 1;
      }

      const lastDocument = communitiesSnapshot.docs.at(-1) ?? null;
      const nextCursor = lastDocument?.id ?? null;
      const hasMore = communitiesSnapshot.size === limit && !!nextCursor;

      console.log('[community] Member count reconciliation completed.', {
        actorUid,
        dryRun,
        limit,
        startAfterCommunityId,
        nextCursor,
        hasMore,
        processed: communitiesSnapshot.size,
        consistent,
        drifted,
        invalidProjection,
        invalidMembershipState,
        repaired,
        missing,
      });

      return {
        ok: true,
        dryRun,
        limit,
        startAfterCommunityId,
        nextCursor,
        hasMore,
        processed: communitiesSnapshot.size,
        consistent,
        drifted,
        invalidProjection,
        invalidMembershipState,
        repaired,
        missing,
        items,
      };
    }
  );
