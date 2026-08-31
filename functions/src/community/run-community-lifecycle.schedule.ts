// functions/src/community/run-community-lifecycle.schedule.ts
// -----------------------------------------------------------------------------
// RUN COMMUNITY LIFECYCLE
// -----------------------------------------------------------------------------
// Avalia Comunidades comuns diariamente, em páginas estáveis por documentId.
// O cursor é persistido para distribuir custo em bases maiores. Esta rotina NÃO
// apaga Comunidades nem conteúdo: scheduled_for_deletion é somente um estado de
// elegibilidade para uma futura política de purge/retention separada.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildCommunityArchiveRetentionAnchorPlan,
  buildCommunityLifecycleMutationPlan,
  resolveCommunityLifecycleMaxPerRun,
  resolveCommunityLifecycleThresholds,
} from './community-lifecycle-execution.policy';
import { evaluateCommunityLifecycle } from './community-lifecycle.policy';
import { sanitizeCommunityDocument } from './community-preview.model';
import { buildCommunityRankingProjectionPatch } from './community-ranking-sync.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const PAGE_SIZE = 50;
const SYSTEM_SOURCE = 'scheduled-community-lifecycle';

type LifecycleApplyResult =
  | 'unchanged'
  | 'transitioned'
  | 'retention_anchor_backfilled'
  | 'missing';

function normalizeCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 1_500) : null;
}

function buildActiveDiscoveryProjection(
  communityId: string,
  rawCommunity: Record<string, unknown>,
  rawDiscovery: Record<string, unknown> | null,
  now: number
): Record<string, unknown> | null {
  const activeCommunity = {
    ...rawCommunity,
    status: 'active',
    updatedAt: now,
  };
  const sanitized = sanitizeCommunityDocument(
    communityId,
    activeCommunity
  );

  if (!sanitized) return null;

  const moderation = (rawCommunity['moderation'] ?? {}) as Record<string, unknown>;
  const visibility = rawCommunity['visibility'] === 'members_only'
    ? 'members_only'
    : 'public_preview';
  const rankingPatch = buildCommunityRankingProjectionPatch(
    activeCommunity,
    rawDiscovery,
    now
  );

  return {
    communityId: sanitized.communityId,
    name: sanitized.name,
    slug: sanitized.slug,
    description: sanitized.description,
    source: sanitized.source,
    status: 'active',
    moderationState: moderation['state'] === 'active' ? 'active' : 'hidden',
    visibility,
    metrics: sanitized.metrics,
    access: {
      preview: 'authenticated',
      interaction: 'members_only',
      join: sanitized.access.join,
      contentAccess: {
        requiresActiveSubscription:
          sanitized.access.requiresActiveSubscription,
        minimumRole: sanitized.access.minimumRole,
      },
    },
    avatarUrl: rawDiscovery?.['avatarUrl'] ?? sanitized.avatarUrl,
    coverUrl: rawDiscovery?.['coverUrl'] ?? sanitized.coverUrl,
    ...rankingPatch,
    rankScore: now,
    updatedAt: now,
  };
}

async function applyCommunityLifecycle(
  communityId: string,
  thresholds: ReturnType<typeof resolveCommunityLifecycleThresholds>,
  now: number
): Promise<LifecycleApplyResult> {
  const communityRef = db.collection('communities').doc(communityId);
  const discoveryRef = db
    .collection('community_discovery_index')
    .doc(communityId);
  const auditRef = db.collection('community_lifecycle_audit').doc();

  return db.runTransaction(async (transaction): Promise<LifecycleApplyResult> => {
    const [communitySnapshot, discoverySnapshot] = await Promise.all([
      transaction.get(communityRef),
      transaction.get(discoveryRef),
    ]);

    if (!communitySnapshot.exists) return 'missing';

    const community = (communitySnapshot.data() ?? {}) as Record<string, unknown>;
    const source = (community['source'] ?? {}) as Record<string, unknown>;
    if (source['type'] !== 'community') return 'unchanged';

    const retentionAnchorPlan = buildCommunityArchiveRetentionAnchorPlan(
      community,
      now
    );

    if (retentionAnchorPlan) {
      transaction.update(communityRef, retentionAnchorPlan.communityPatch);
      transaction.create(auditRef, {
        action: retentionAnchorPlan.auditAction,
        communityId,
        previousStatus: 'archived',
        nextStatus: 'archived',
        reason: 'legacy_archive_without_retention_anchor',
        createdAt: now,
        source: SYSTEM_SOURCE,
      });
      return 'retention_anchor_backfilled';
    }

    const decision = evaluateCommunityLifecycle(community, now, thresholds);
    const mutationPlan = buildCommunityLifecycleMutationPlan(
      community,
      decision,
      now
    );

    if (!mutationPlan) return 'unchanged';

    transaction.update(communityRef, mutationPlan.communityPatch);

    if (decision.nextStatus === 'active') {
      const discoveryProjection = buildActiveDiscoveryProjection(
        communityId,
        community,
        discoverySnapshot.exists ? discoverySnapshot.data() ?? {} : null,
        now
      );

      if (discoveryProjection) {
        transaction.set(discoveryRef, discoveryProjection, { merge: true });
      } else if (discoverySnapshot.exists) {
        transaction.set(
          discoveryRef,
          { status: 'hidden', updatedAt: now },
          { merge: true }
        );
      }
    } else if (discoverySnapshot.exists) {
      transaction.set(
        discoveryRef,
        mutationPlan.discoveryPatch,
        { merge: true }
      );
    }

    transaction.create(auditRef, {
      action: mutationPlan.auditAction,
      communityId,
      previousStatus: decision.currentStatus,
      nextStatus: decision.nextStatus,
      reason: decision.reason,
      deletionEligibleAt: decision.deletionEligibleAt,
      createdAt: now,
      source: SYSTEM_SOURCE,
    });

    return 'transitioned';
  });
}

export const runCommunityLifecycle = onSchedule(
  {
    schedule: '10 4 * * *',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    if (!isCommunityPreviewRuntimeAvailable()) {
      logger.info('community_lifecycle_skipped_runtime_guard');
      return;
    }

    const now = Date.now();
    const configRef = db.collection('platform_config').doc('community');
    const runtimeRef = db
      .collection('community_lifecycle_runtime')
      .doc('daily');
    const [configSnapshot, runtimeSnapshot] = await Promise.all([
      configRef.get(),
      runtimeRef.get(),
    ]);
    const config = configSnapshot.exists ? configSnapshot.data() ?? {} : {};
    const runtime = runtimeSnapshot.exists ? runtimeSnapshot.data() ?? {} : {};
    const thresholds = resolveCommunityLifecycleThresholds(config);
    const maxPerRun = resolveCommunityLifecycleMaxPerRun(config);
    let cursor = normalizeCursor(runtime['cursor']);
    let processed = 0;
    let transitioned = 0;
    let retentionAnchorsBackfilled = 0;
    let missing = 0;
    let reachedEnd = false;

    while (processed < maxPerRun && !reachedEnd) {
      const remaining = maxPerRun - processed;
      const pageLimit = Math.min(PAGE_SIZE, remaining);
      let pageQuery = db
        .collection('communities')
        .where('source.type', '==', 'community')
        .orderBy(FieldPath.documentId())
        .limit(pageLimit);

      if (cursor) pageQuery = pageQuery.startAfter(cursor);

      const pageSnapshot = await pageQuery.get();

      if (pageSnapshot.empty) {
        cursor = null;
        reachedEnd = true;
        break;
      }

      for (const document of pageSnapshot.docs) {
        const previewDecision = evaluateCommunityLifecycle(
          document.data(),
          now,
          thresholds
        );
        const needsRetentionAnchor =
          buildCommunityArchiveRetentionAnchorPlan(document.data(), now) !== null;

        if (previewDecision.changed || needsRetentionAnchor) {
          const result = await applyCommunityLifecycle(
            document.id,
            thresholds,
            now
          );

          if (result === 'transitioned') transitioned += 1;
          if (result === 'retention_anchor_backfilled') {
            retentionAnchorsBackfilled += 1;
          }
          if (result === 'missing') missing += 1;
        }

        processed += 1;
        cursor = document.id;
      }

      if (pageSnapshot.size < pageLimit) {
        cursor = null;
        reachedEnd = true;
      }
    }

    await runtimeRef.set(
      {
        cursor,
        processed,
        transitioned,
        retentionAnchorsBackfilled,
        missing,
        reachedEnd,
        thresholds,
        lastRunAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    logger.info('community_lifecycle_run_completed', {
      processed,
      transitioned,
      retentionAnchorsBackfilled,
      missing,
      reachedEnd,
      nextCursor: cursor,
    });
  }
);
