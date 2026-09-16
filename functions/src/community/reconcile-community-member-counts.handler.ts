// functions/src/community/reconcile-community-member-counts.handler.ts
// -----------------------------------------------------------------------------
// RECONCILE COMMUNITY MEMBER COUNTS
// -----------------------------------------------------------------------------
// Manutenção administrativa explícita para auditar/reparar metrics.memberCount.
// Não substitui os deltas transacionais dos handlers de membership. A leitura
// usa agregações server-side para não materializar o histórico inteiro e o
// reparo confirma a versão da Comunidade dentro da transação antes de escrever.
// -----------------------------------------------------------------------------

import {
  FieldPath,
  type DocumentSnapshot,
  type DocumentReference,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  COMMUNITY_MEMBERSHIP_RECONCILIATION_STATUSES,
  type CommunityMemberCountProjectionState,
  type CommunityMembershipOccupancySummary,
  evaluateCommunityMemberCountProjection,
  summarizeCommunityMembershipOccupancyFromCounts,
} from './community-member-count-reconciliation.policy';
import { hasCommunityOperationsPermission } from './community-operations.authorization';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

interface ReconcileCommunityMemberCountsRequest {
  limit?: unknown;
  dryRun?: unknown;
  startAfterCommunityId?: unknown;
}

type CommunityMemberCountReconciliationItemState =
  | CommunityMemberCountProjectionState
  | 'concurrent_change';

interface CommunityMemberCountReconciliationItem {
  communityId: string;
  state: CommunityMemberCountReconciliationItemState;
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
  concurrentChanges: number;
  repaired: number;
  missing: number;
  items: CommunityMemberCountReconciliationItem[];
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A reconciliação de participantes não está disponível neste ambiente.'
  );
}

async function assertReconciliationAuthorization(
  actorUid: string | null,
  authToken: Record<string, unknown> | undefined
): Promise<string> {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (authToken?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique o e-mail da conta administrativa para continuar.'
    );
  }

  if (hasCommunityOperationsPermission(authToken, 'community:reconcile')) {
    return actorUid;
  }

  const actorSnapshot = await db.collection('users').doc(actorUid).get();
  if (
    hasCommunityOperationsPermission(
      actorSnapshot.exists ? actorSnapshot.data() : null,
      'community:reconcile'
    )
  ) {
    return actorUid;
  }

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

function hasSameDocumentVersion(
  left: DocumentSnapshot,
  right: DocumentSnapshot
): boolean {
  return Boolean(
    left.updateTime
    && right.updateTime
    && left.updateTime.isEqual(right.updateTime)
  );
}

async function readMembershipOccupancy(
  communityRef: DocumentReference
): Promise<CommunityMembershipOccupancySummary> {
  const membersQuery = communityRef.collection('members');
  const [totalSnapshot, activeSnapshot, knownStatusSnapshot] = await Promise.all([
    membersQuery.count().get(),
    membersQuery.where('status', '==', 'active').count().get(),
    membersQuery
      .where(
        'status',
        'in',
        [...COMMUNITY_MEMBERSHIP_RECONCILIATION_STATUSES]
      )
      .count()
      .get(),
  ]);

  return summarizeCommunityMembershipOccupancyFromCounts({
    totalCount: totalSnapshot.data().count,
    activeCount: activeSnapshot.data().count,
    knownStatusCount: knownStatusSnapshot.data().count,
  });
}

function buildReconciliationItem(input: {
  communityId: string;
  communitySnapshot: DocumentSnapshot;
  discoverySnapshot: DocumentSnapshot;
  occupancy: CommunityMembershipOccupancySummary;
  concurrentChange: boolean;
  repaired: boolean;
}): CommunityMemberCountReconciliationItem {
  const communityDecision = evaluateCommunityMemberCountProjection(
    readProjectedCount(input.communitySnapshot.data()),
    input.occupancy
  );
  const discoveryDecision = input.discoverySnapshot.exists
    ? evaluateCommunityMemberCountProjection(
      readProjectedCount(input.discoverySnapshot.data()),
      input.occupancy
    )
    : null;

  return {
    communityId: input.communityId,
    state: input.concurrentChange
      ? 'concurrent_change'
      : communityDecision.state,
    projectedCount: communityDecision.projectedCount,
    activeCount: input.occupancy.activeCount,
    invalidStatusCount: input.occupancy.invalidStatusCount,
    discoveryProjectedCount: discoveryDecision?.projectedCount ?? null,
    discoveryNeedsRepair: input.concurrentChange
      ? false
      : discoveryDecision?.needsRepair === true
        && discoveryDecision.repairable,
    repaired: input.repaired,
  };
}

export const reconcileCommunityMemberCounts =
  onCall<ReconcileCommunityMemberCountsRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<ReconcileCommunityMemberCountsResponse> => {
      assertRuntime();
      assertCommunityCallableAppCheck(request.app);

      const authToken = (request.auth?.token ?? undefined) as
        | Record<string, unknown>
        | undefined;
      const actorUid = await assertReconciliationAuthorization(
        request.auth?.uid ?? null,
        authToken
      );
      assertRecentAuthentication(authToken);
      await consumeCommunityRateLimit({
        action: 'operations_reconciliation',
        actorUid,
      });

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
      let concurrentChanges = 0;
      let repaired = 0;
      let missing = 0;

      for (const scanCommunitySnapshot of communitiesSnapshot.docs) {
        const communityId = scanCommunitySnapshot.id;
        const communityRef = scanCommunitySnapshot.ref;
        const discoveryRef = db
          .collection('community_discovery_index')
          .doc(communityId);
        const occupancy = await readMembershipOccupancy(communityRef);

        let item: CommunityMemberCountReconciliationItem | null;

        if (dryRun) {
          const [currentCommunitySnapshot, discoverySnapshot] =
            await Promise.all([
              communityRef.get(),
              discoveryRef.get(),
            ]);

          if (!currentCommunitySnapshot.exists) {
            item = null;
          } else {
            item = buildReconciliationItem({
              communityId,
              communitySnapshot: currentCommunitySnapshot,
              discoverySnapshot,
              occupancy,
              concurrentChange: !hasSameDocumentVersion(
                scanCommunitySnapshot,
                currentCommunitySnapshot
              ),
              repaired: false,
            });
          }
        } else {
          item = await db.runTransaction(
            async (transaction): Promise<CommunityMemberCountReconciliationItem | null> => {
              const [communitySnapshot, discoverySnapshot] = await Promise.all([
                transaction.get(communityRef),
                transaction.get(discoveryRef),
              ]);

              if (!communitySnapshot.exists) return null;

              if (!hasSameDocumentVersion(
                scanCommunitySnapshot,
                communitySnapshot
              )) {
                return buildReconciliationItem({
                  communityId,
                  communitySnapshot,
                  discoverySnapshot,
                  occupancy,
                  concurrentChange: true,
                  repaired: false,
                });
              }

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

              if (shouldRepair) {
                const now = Date.now();
                transaction.update(communityRef, {
                  'metrics.memberCount': occupancy.activeCount,
                  updatedAt: now,
                });

                if (discoverySnapshot.exists && discoveryNeedsRepair) {
                  transaction.update(discoveryRef, {
                    'metrics.memberCount': occupancy.activeCount,
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
              }

              return buildReconciliationItem({
                communityId,
                communitySnapshot,
                discoverySnapshot,
                occupancy,
                concurrentChange: false,
                repaired: shouldRepair,
              });
            }
          );
        }

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
        if (item.state === 'concurrent_change') concurrentChanges += 1;
        if (item.repaired) repaired += 1;
      }

      const lastDocument = communitiesSnapshot.docs.at(-1) ?? null;
      const nextCursor = lastDocument?.id ?? null;
      const hasMore = communitiesSnapshot.size === limit && !!nextCursor;

      logger.info('community_member_count_reconciliation_completed', {
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
        concurrentChanges,
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
        concurrentChanges,
        repaired,
        missing,
        items,
      };
    }
  );
