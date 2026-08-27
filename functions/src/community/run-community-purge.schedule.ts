// functions/src/community/run-community-purge.schedule.ts
// -----------------------------------------------------------------------------
// RUN COMMUNITY PURGE
// -----------------------------------------------------------------------------
// Purga física backend-only para Comunidades que já passaram pelo lifecycle e
// pelo período adicional de segurança. O claim é o ponto de não retorno: após
// ele, a limpeza é idempotente e pode ser retomada em caso de falha parcial.
// O documento canônico é removido somente na transação final.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  CommunityPurgeCleanupSummary,
  executeCommunityPurgeCleanup,
  hasBlockingCommunityModerationReference,
} from './community-purge.firestore';
import {
  COMMUNITY_PURGE_POLICY_VERSION,
  CommunityPurgeBlockReason,
  CommunityPurgeDecision,
  evaluateCommunityPurgeEligibility,
  resolveCommunityPurgeGraceDays,
} from './community-purge.policy';

const PAGE_SIZE = 25;
const DEFAULT_MAX_PER_RUN = 25;
const PURGE_LEASE_MS = 30 * 60 * 1_000;
const RETRY_BASE_MS = 60 * 60 * 1_000;
const RETRY_MAX_MS = 24 * 60 * 60 * 1_000;
const SYSTEM_SOURCE = 'scheduled-community-purge';

type PurgeClaim = {
  attemptCount: number;
  decision: CommunityPurgeDecision;
};

function normalizeCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 1_500) : null;
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAttemptCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

function resolveCommunityPurgeMaxPerRun(rawConfig: unknown): number {
  const config = (rawConfig ?? {}) as Record<string, unknown>;
  return normalizeInteger(
    config['lifecyclePurgeMaxCommunitiesPerRun'],
    DEFAULT_MAX_PER_RUN,
    5,
    200
  );
}

function isRetryDue(lifecycle: Record<string, unknown>, now: number): boolean {
  const retryAt = normalizeEpoch(lifecycle['purgeNextAttemptAt']);
  return retryAt === null || retryAt <= now;
}

function isLeaseAvailable(
  lifecycle: Record<string, unknown>,
  now: number,
  executionId: string
): boolean {
  const owner = String(lifecycle['purgeLeaseOwner'] ?? '').trim();
  const leaseUntil = normalizeEpoch(lifecycle['purgeLeaseUntil']);

  return !owner
    || owner === executionId
    || leaseUntil === null
    || leaseUntil <= now;
}

function buildRetryAt(attemptCount: number, now: number): number {
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 10);
  const delay = Math.min(RETRY_BASE_MS * (2 ** exponent), RETRY_MAX_MS);
  return now + delay;
}

function sanitizeErrorCode(error: unknown): string {
  return String(
    (error as { code?: unknown } | null)?.code
      ?? (error as { name?: unknown } | null)?.name
      ?? 'internal-error'
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'internal-error';
}

function incrementReason(
  counters: Record<string, number>,
  reason: CommunityPurgeBlockReason
): void {
  counters[reason] = (counters[reason] ?? 0) + 1;
}

async function claimCommunityPurge(input: {
  communityId: string;
  now: number;
  executionId: string;
  graceDays: number;
  hasBlockingModerationReference: boolean;
}): Promise<PurgeClaim | null> {
  const communityRef = db.collection('communities').doc(input.communityId);
  const auditRef = db.collection('community_purge_audit').doc(input.communityId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(communityRef);
    if (!snapshot.exists) return null;

    const community = snapshot.data() ?? {};
    const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;
    const decision = evaluateCommunityPurgeEligibility(
      community,
      input.now,
      input.graceDays,
      {
        hasBlockingModerationReference:
          input.hasBlockingModerationReference,
      }
    );

    if (
      !decision.eligible
      || !isRetryDue(lifecycle, input.now)
      || !isLeaseAvailable(lifecycle, input.now, input.executionId)
    ) {
      return null;
    }

    const attemptCount = normalizeAttemptCount(
      lifecycle['purgeAttemptCount']
    ) + 1;
    const leaseUntil = input.now + PURGE_LEASE_MS;
    const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;

    transaction.update(communityRef, {
      'lifecycle.purgeState': 'claimed',
      'lifecycle.purgeAttemptCount': attemptCount,
      'lifecycle.purgeClaimedAt': input.now,
      'lifecycle.purgeLastAttemptAt': input.now,
      'lifecycle.purgeNextAttemptAt': null,
      'lifecycle.purgeLeaseOwner': input.executionId,
      'lifecycle.purgeLeaseUntil': leaseUntil,
      'lifecycle.purgeLastErrorCode': null,
      'lifecycle.purgePolicyVersion': COMMUNITY_PURGE_POLICY_VERSION,
      updatedAt: input.now,
    });
    transaction.set(
      auditRef,
      {
        communityId: input.communityId,
        sourceType: 'community',
        ownerUid: String(community['ownerUid'] ?? '').trim() || null,
        scheduledForDeletionAt: decision.scheduledForDeletionAt,
        purgeEligibleAt: decision.purgeEligibleAt,
        graceDays: decision.graceDays,
        memberCount: Number(metrics['memberCount'] ?? 0),
        policyVersion: decision.policyVersion,
        attemptCount,
        state: 'claimed',
        claimedAt: input.now,
        lastAttemptAt: input.now,
        completedAt: null,
        lastErrorCode: null,
        source: SYSTEM_SOURCE,
        updatedAt: input.now,
      },
      { merge: true }
    );

    return { attemptCount, decision };
  });
}

async function scheduleRetry(input: {
  communityId: string;
  executionId: string;
  attemptCount: number;
  now: number;
  error: unknown;
}): Promise<void> {
  const communityRef = db.collection('communities').doc(input.communityId);
  const auditRef = db.collection('community_purge_audit').doc(input.communityId);
  const errorCode = sanitizeErrorCode(input.error);
  const retryAt = buildRetryAt(input.attemptCount, input.now);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(communityRef);

    if (snapshot.exists) {
      const lifecycle = (snapshot.data()?.['lifecycle'] ?? {}) as Record<
        string,
        unknown
      >;
      const leaseOwner = String(lifecycle['purgeLeaseOwner'] ?? '').trim();

      if (!leaseOwner || leaseOwner === input.executionId) {
        transaction.update(communityRef, {
          'lifecycle.purgeState': 'retry_scheduled',
          'lifecycle.purgeNextAttemptAt': retryAt,
          'lifecycle.purgeLeaseOwner': null,
          'lifecycle.purgeLeaseUntil': null,
          'lifecycle.purgeLastErrorCode': errorCode,
          updatedAt: input.now,
        });
      }
    }

    transaction.set(
      auditRef,
      {
        communityId: input.communityId,
        state: 'retry_scheduled',
        attemptCount: input.attemptCount,
        retryAt,
        lastErrorCode: errorCode,
        source: SYSTEM_SOURCE,
        updatedAt: input.now,
      },
      { merge: true }
    );
  });
}

async function finalizeCommunityPurge(input: {
  communityId: string;
  executionId: string;
  attemptCount: number;
  cleanup: CommunityPurgeCleanupSummary;
  now: number;
}): Promise<boolean> {
  const communityRef = db.collection('communities').doc(input.communityId);
  const auditRef = db.collection('community_purge_audit').doc(input.communityId);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(communityRef);

    if (!snapshot.exists) {
      transaction.set(
        auditRef,
        {
          state: 'completed',
          completedAt: input.now,
          cleanup: input.cleanup,
          source: SYSTEM_SOURCE,
          updatedAt: input.now,
        },
        { merge: true }
      );
      return true;
    }

    const community = snapshot.data() ?? {};
    const source = (community['source'] ?? {}) as Record<string, unknown>;
    const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;
    const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;
    const memberCount = metrics['memberCount'];
    const leaseOwner = String(lifecycle['purgeLeaseOwner'] ?? '').trim();

    if (
      source['type'] !== 'community'
      || community['status'] !== 'scheduled_for_deletion'
      || memberCount !== 0
      || leaseOwner !== input.executionId
    ) {
      return false;
    }

    transaction.delete(communityRef);
    transaction.set(
      auditRef,
      {
        communityId: input.communityId,
        state: 'completed',
        attemptCount: input.attemptCount,
        cleanup: input.cleanup,
        completedAt: input.now,
        lastErrorCode: null,
        source: SYSTEM_SOURCE,
        updatedAt: input.now,
      },
      { merge: true }
    );

    return true;
  });
}

export const runCommunityPurge = onSchedule(
  {
    schedule: '40 */6 * * *',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const now = Date.now();
    const executionId = randomUUID();
    const configRef = db.collection('platform_config').doc('community');
    const runtimeRef = db.collection('community_purge_runtime').doc('scheduler');
    const [configSnapshot, runtimeSnapshot] = await Promise.all([
      configRef.get(),
      runtimeRef.get(),
    ]);
    const config = configSnapshot.exists ? configSnapshot.data() ?? {} : {};
    const runtime = runtimeSnapshot.exists ? runtimeSnapshot.data() ?? {} : {};
    const graceDays = resolveCommunityPurgeGraceDays(config);
    const maxPerRun = resolveCommunityPurgeMaxPerRun(config);
    const blockedReasons: Record<string, number> = {};
    let cursor = normalizeCursor(runtime['cursor']);
    let scanned = 0;
    let claimed = 0;
    let completed = 0;
    let retries = 0;
    let reachedEnd = false;

    while (scanned < maxPerRun && !reachedEnd) {
      const remaining = maxPerRun - scanned;
      const pageLimit = Math.min(PAGE_SIZE, remaining);
      let query = db
        .collection('communities')
        .where('status', '==', 'scheduled_for_deletion')
        .orderBy(FieldPath.documentId())
        .limit(pageLimit);

      if (cursor) query = query.startAfter(cursor);

      const pageSnapshot = await query.get();
      if (pageSnapshot.empty) {
        cursor = null;
        reachedEnd = true;
        break;
      }

      for (const document of pageSnapshot.docs) {
        const communityId = document.id;
        const community = document.data() ?? {};
        const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;
        cursor = communityId;
        scanned += 1;

        if (!isRetryDue(lifecycle, now)) {
          continue;
        }

        try {
          const hasBlockingModerationReference =
            await hasBlockingCommunityModerationReference(communityId);
          const previewDecision = evaluateCommunityPurgeEligibility(
            community,
            now,
            graceDays,
            { hasBlockingModerationReference }
          );

          if (!previewDecision.eligible) {
            incrementReason(blockedReasons, previewDecision.reason);
            continue;
          }

          const claim = await claimCommunityPurge({
            communityId,
            now,
            executionId,
            graceDays,
            hasBlockingModerationReference,
          });

          if (!claim) continue;
          claimed += 1;

          try {
            const cleanup = await executeCommunityPurgeCleanup(communityId);
            const finalized = await finalizeCommunityPurge({
              communityId,
              executionId,
              attemptCount: claim.attemptCount,
              cleanup,
              now: Date.now(),
            });

            if (!finalized) {
              throw new Error('community-purge-final-state-changed');
            }

            completed += 1;
          } catch (error) {
            await scheduleRetry({
              communityId,
              executionId,
              attemptCount: claim.attemptCount,
              now: Date.now(),
              error,
            });
            retries += 1;

            logger.error('community_purge_candidate_failed', {
              communityId,
              errorCode: sanitizeErrorCode(error),
            });
          }
        } catch (error) {
          retries += 1;
          logger.error('community_purge_candidate_preflight_failed', {
            communityId,
            errorCode: sanitizeErrorCode(error),
          });
        }
      }

      if (pageSnapshot.size < pageLimit) {
        cursor = null;
        reachedEnd = true;
      }
    }

    await runtimeRef.set(
      {
        cursor,
        scanned,
        claimed,
        completed,
        retries,
        blockedReasons,
        graceDays,
        maxPerRun,
        reachedEnd,
        executionId,
        lastRunAt: now,
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    logger.info('community_purge_run_completed', {
      scanned,
      claimed,
      completed,
      retries,
      blockedReasons,
      graceDays,
      reachedEnd,
      nextCursor: cursor,
    });
  }
);
