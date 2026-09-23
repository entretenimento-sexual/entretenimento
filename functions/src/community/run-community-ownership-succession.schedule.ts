// functions/src/community/run-community-ownership-succession.schedule.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNERSHIP SUCCESSION LIFECYCLE
// -----------------------------------------------------------------------------
// Expira ofertas pendentes e encerra casos terminais cujo prazo acabou.
// Frequência de 6h é suficiente para janelas em dias e evita polling caro.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import {
  stopOpenCommunityBoostForCommunityInTransaction,
} from '../community-boost/community-boost-authority.service';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { resolveCommunityMemberCountDelta } from './community-member-count.policy';
import {
  isCommunityOwnershipTransferExpired,
} from './community-ownership-transfer.workflow.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const REQUEST_COLLECTION = 'community_ownership_transfer_requests';
const ACTIVE_SLOT_COLLECTION = 'community_ownership_transfer_active';
const CASE_COLLECTION = 'community_owner_succession_cases';
const REQUEST_SCAN_LIMIT = 100;
const CASE_SCAN_LIMIT = 50;

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(normalized) ? normalized : null;
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function expireTransferRequest(
  requestId: string,
  now: number
): Promise<boolean> {
  const requestRef = db.collection(REQUEST_COLLECTION).doc(requestId);

  return db.runTransaction(async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) return false;

    const request = requestSnapshot.data() ?? {};
    const communityId = normalizeId(request['communityId']);
    const candidateUid = normalizeId(request['candidateUid']);
    const previousOwnerUid = normalizeId(request['previousOwnerUid']);
    const mode = request['mode'] === 'terminal_succession'
      ? 'terminal_succession'
      : request['mode'] === 'voluntary'
        ? 'voluntary'
        : null;
    const expiresAt = normalizeEpoch(request['expiresAt']);

    if (
      !communityId
      || !candidateUid
      || !previousOwnerUid
      || !mode
      || !expiresAt
      || !isCommunityOwnershipTransferExpired(
        request['status'],
        expiresAt,
        now
      )
    ) {
      return false;
    }

    const activeSlotRef = db
      .collection(ACTIVE_SLOT_COLLECTION)
      .doc(communityId);
    const caseRef = db.collection(CASE_COLLECTION).doc(communityId);
    const activeSlotSnapshot = await transaction.get(activeSlotRef);
    const caseSnapshot = mode === 'terminal_succession'
      ? await transaction.get(caseRef)
      : null;

    transaction.set(requestRef, {
      status: 'expired',
      resolvedAt: now,
      updatedAt: now,
    }, { merge: true });

    if (
      activeSlotSnapshot.exists
      && activeSlotSnapshot.data()?.['requestId'] === requestId
    ) {
      transaction.delete(activeSlotRef);
    }

    if (
      caseSnapshot?.exists
      && caseSnapshot.data()?.['activeRequestId'] === requestId
    ) {
      transaction.set(caseRef, {
        activeRequestId: null,
        updatedAt: now,
      }, { merge: true });
    }

    transaction.set(
      db.collection('notifications').doc(
        `community-ownership-requested-${requestId}-${candidateUid}`.slice(
          0,
          240
        )
      ),
      {
        actionRequired: false,
        resolvedAt: FieldValue.serverTimestamp(),
        resolution: 'expired',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (mode === 'voluntary') {
      transaction.set(
        db.collection('notifications').doc(
          `community-ownership-expired-${requestId}-${previousOwnerUid}`.slice(
            0,
            240
          )
        ),
        {
          userId: previousOwnerUid,
          type: 'community.ownership.transfer_expired',
          title: 'Transferência de propriedade expirada',
          body: 'O convite para assumir a Comunidade expirou sem aceite.',
          route:
            '/dashboard/comunidades/propriedade'
            + `?request=${encodeURIComponent(requestId)}`,
          communityId,
          ownershipRequestId: requestId,
          actorUid: candidateUid,
          actionRequired: true,
          pushMode: 'in_app_only',
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    transaction.set(
      db.collection('community_membership_audit').doc(),
      {
        action: 'community_ownership_transfer_expired',
        requestId,
        communityId,
        previousOwnerUid,
        candidateUid,
        mode,
        createdAt: now,
        source: 'scheduled-ownership-succession',
      }
    );

    return true;
  });
}

async function archiveExpiredTerminalCase(
  communityId: string,
  now: number
): Promise<boolean> {
  const caseRef = db.collection(CASE_COLLECTION).doc(communityId);

  return db.runTransaction(async (transaction) => {
    const caseSnapshot = await transaction.get(caseRef);
    if (!caseSnapshot.exists) return false;

    const successionCase = caseSnapshot.data() ?? {};
    const deadlineAt = normalizeEpoch(successionCase['deadlineAt']);
    const previousOwnerUid = normalizeId(successionCase['previousOwnerUid']);

    if (
      successionCase['status'] !== 'open'
      || !deadlineAt
      || deadlineAt > now
      || !previousOwnerUid
    ) {
      return false;
    }

    const communityRef = db.collection('communities').doc(communityId);
    const discoveryRef = db
      .collection('community_discovery_index')
      .doc(communityId);
    const previousOwnerMembershipRef = communityRef
      .collection('members')
      .doc(previousOwnerUid);
    const previousOwnerIndexRef = db
      .collection('community_user_index')
      .doc(previousOwnerUid)
      .collection('items')
      .doc(communityId);
    const activeSlotRef = db
      .collection(ACTIVE_SLOT_COLLECTION)
      .doc(communityId);

    const [
      communitySnapshot,
      discoverySnapshot,
      previousOwnerMembershipSnapshot,
      activeSlotSnapshot,
    ] = await Promise.all([
      transaction.get(communityRef),
      transaction.get(discoveryRef),
      transaction.get(previousOwnerMembershipRef),
      transaction.get(activeSlotRef),
    ]);

    if (!communitySnapshot.exists) {
      transaction.set(caseRef, {
        status: 'archived',
        archivedAt: now,
        archiveReason: 'community_missing',
        updatedAt: now,
      }, { merge: true });
      return true;
    }

    let activeRequestRef: FirebaseFirestore.DocumentReference | null = null;
    let activeRequestSnapshot: FirebaseFirestore.DocumentSnapshot | null = null;
    const activeRequestId = activeSlotSnapshot.exists
      ? normalizeId(activeSlotSnapshot.data()?.['requestId'])
      : null;

    if (activeRequestId) {
      activeRequestRef = db.collection(REQUEST_COLLECTION).doc(activeRequestId);
      activeRequestSnapshot = await transaction.get(activeRequestRef);
    }

    await stopOpenCommunityBoostForCommunityInTransaction({
      transaction,
      communityId,
      reason: 'community_lifecycle_archived',
      now,
      actorUid: 'system',
    });

    const community = communitySnapshot.data() ?? {};
    const status = String(community['status'] ?? '').trim();
    const previousOwnerMembership = previousOwnerMembershipSnapshot.exists
      ? previousOwnerMembershipSnapshot.data() ?? {}
      : {};
    const previousOwnerWasActive =
      previousOwnerMembershipSnapshot.exists
      && previousOwnerMembership['status'] === 'active';
    const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;
    const nextMemberCount = previousOwnerWasActive
      ? resolveCommunityMemberCountDelta(metrics['memberCount'], -1)
      : null;

    if (previousOwnerWasActive && nextMemberCount === null) {
      logger.error('community_ownership_succession_member_count_inconsistent', {
        communityId,
        previousOwnerUid,
      });
      return false;
    }

    if (activeRequestRef && activeRequestSnapshot?.exists) {
      transaction.set(activeRequestRef, {
        status: 'expired',
        resolvedAt: now,
        updatedAt: now,
      }, { merge: true });

      const candidateUid = normalizeId(
        activeRequestSnapshot.data()?.['candidateUid']
      );
      if (candidateUid) {
        transaction.set(
          db.collection('notifications').doc(
            `community-ownership-archived-${activeRequestId}-${candidateUid}`.slice(
              0,
              240
            )
          ),
          {
            userId: candidateUid,
            type: 'community.ownership.succession_archived',
            title: 'Sucessão encerrada',
            body:
              'O prazo de sucessão terminou e a Comunidade foi arquivada com segurança.',
            route: '/dashboard/comunidades/propriedade',
            communityId,
            ownershipRequestId: activeRequestId,
            actionRequired: false,
            pushMode: 'in_app_only',
            readAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    if (activeSlotSnapshot.exists) {
      transaction.delete(activeSlotRef);
    }

    transaction.update(communityRef, {
      status: 'archived',
      visibility: 'hidden',
      ownerUid: FieldValue.delete(),
      archivedAt: now,
      archivedBy: 'system',
      archiveReason: 'terminal_ownership_succession_expired',
      ownershipSuccession: FieldValue.delete(),
      'lifecycle.state': 'archived',
      'lifecycle.archivedAt': now,
      'lifecycle.scheduledForDeletionAt': null,
      'lifecycle.interactionBlocked': true,
      'lifecycle.updatedAt': now,
      ...(previousOwnerWasActive && nextMemberCount !== null
        ? { 'metrics.memberCount': nextMemberCount }
        : {}),
      updatedAt: now,
    });

    if (discoverySnapshot.exists) {
      transaction.delete(discoveryRef);
    }

    if (previousOwnerMembershipSnapshot.exists) {
      transaction.set(previousOwnerMembershipRef, {
        role: 'member',
        status: 'left',
        leftAt: now,
        ownershipReleasedAt: now,
        ownershipReleaseReason: 'terminal_succession_expired',
        updatedAt: now,
        source: 'terminal-ownership-succession',
      }, { merge: true });
    }
    transaction.delete(previousOwnerIndexRef);

    transaction.set(caseRef, {
      status: 'archived',
      activeRequestId: null,
      archivedAt: now,
      archiveReason: 'succession_window_expired',
      updatedAt: now,
    }, { merge: true });

    transaction.set(
      db.collection('community_membership_audit').doc(),
      {
        action: 'community_owner_terminal_succession_archived',
        communityId,
        previousOwnerUid,
        previousCommunityStatus: status || null,
        deadlineAt,
        createdAt: now,
        source: 'scheduled-ownership-succession',
      }
    );

    return true;
  });
}

export const runCommunityOwnershipSuccessionLifecycle = onSchedule(
  {
    schedule: '17 */6 * * *',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    if (!isCommunityPreviewRuntimeAvailable()) {
      logger.info('community_ownership_succession_skipped_runtime_guard');
      return;
    }

    const now = Date.now();
    const pendingRequests = await db
      .collection(REQUEST_COLLECTION)
      .where('status', '==', 'pending')
      .limit(REQUEST_SCAN_LIMIT)
      .get();

    let expiredRequests = 0;
    for (const request of pendingRequests.docs) {
      const expiresAt = normalizeEpoch(request.data()?.['expiresAt']);
      if (!expiresAt || expiresAt > now) continue;
      if (await expireTransferRequest(request.id, now)) {
        expiredRequests += 1;
      }
    }

    const openCases = await db
      .collection(CASE_COLLECTION)
      .where('status', '==', 'open')
      .limit(CASE_SCAN_LIMIT)
      .get();

    let archivedCases = 0;
    for (const successionCase of openCases.docs) {
      const deadlineAt = normalizeEpoch(successionCase.data()?.['deadlineAt']);
      if (!deadlineAt || deadlineAt > now) continue;
      if (await archiveExpiredTerminalCase(successionCase.id, now)) {
        archivedCases += 1;
      }
    }

    logger.info('community_ownership_succession_lifecycle_completed', {
      pendingRequestScanCount: pendingRequests.size,
      expiredRequests,
      openCaseScanCount: openCases.size,
      archivedCases,
      scheduleCadenceHours: 6,
    });
  }
);
