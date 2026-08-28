// functions/src/community/community-lifecycle-execution.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityArchiveRetentionAnchorPlan,
  buildCommunityLifecycleMutationPlan,
  resolveCommunityLifecycleMaxPerRun,
  resolveCommunityLifecycleThresholds,
} from './community-lifecycle-execution.policy';
import { evaluateCommunityLifecycle } from './community-lifecycle.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

function community(overrides: Record<string, unknown> = {}) {
  return {
    source: { type: 'community', id: 'community-1' },
    status: 'active',
    visibility: 'public_preview',
    moderation: { state: 'active' },
    metrics: { memberCount: 5, postCount: 1, mediaCount: 0, topicCount: 0 },
    lifecycle: {
      lastMeaningfulActivityAt: NOW - 10 * DAY_MS,
      dormantAt: null,
      archivedAt: null,
      scheduledForDeletionAt: null,
    },
    createdAt: NOW - 200 * DAY_MS,
    updatedAt: NOW - 10 * DAY_MS,
    ...overrides,
  };
}

test('resolve limites configuráveis preservando relações mínimas', () => {
  const thresholds = resolveCommunityLifecycleThresholds({
    lifecycleDormantAfterDays: 45,
    lifecycleArchiveAfterDays: 30,
    lifecycleEmptyArchiveAfterDays: 20,
    lifecycleEmptyDeletionAfterDays: 10,
    lifecycleOrphanedContentDeletionAfterDays: 15,
  });

  assert.equal(thresholds.dormantAfterDays, 45);
  assert.equal(thresholds.archiveAfterDays, 45);
  assert.equal(thresholds.emptyArchiveAfterDays, 20);
  assert.equal(thresholds.emptyDeletionAfterDays, 20);
  assert.equal(thresholds.orphanedContentDeletionAfterDays, 20);
});

test('limita quantidade processada por execução', () => {
  assert.equal(resolveCommunityLifecycleMaxPerRun({}), 500);
  assert.equal(
    resolveCommunityLifecycleMaxPerRun({ lifecycleMaxCommunitiesPerRun: 2 }),
    50
  );
  assert.equal(
    resolveCommunityLifecycleMaxPerRun({ lifecycleMaxCommunitiesPerRun: 99_999 }),
    5_000
  );
});

test('ancora retenção de Comunidade arquivada legada sem archivedAt', () => {
  const plan = buildCommunityArchiveRetentionAnchorPlan(
    community({
      status: 'archived',
      lifecycle: { lastMeaningfulActivityAt: NOW - 400 * DAY_MS },
    }),
    NOW
  );

  assert.ok(plan);
  assert.equal(plan.communityPatch['lifecycle.archivedAt'], NOW);
  assert.equal(
    plan.communityPatch['lifecycle.lastMeaningfulActivityAt'],
    NOW - 400 * DAY_MS
  );
});

test('backfill preserva archivedAt legado do arquivamento manual', () => {
  const legacyArchivedAt = NOW - 40 * DAY_MS;
  const plan = buildCommunityArchiveRetentionAnchorPlan(
    community({
      status: 'archived',
      archivedAt: legacyArchivedAt,
      lifecycle: { lastMeaningfulActivityAt: NOW - 100 * DAY_MS },
    }),
    NOW
  );

  assert.ok(plan);
  assert.equal(plan.communityPatch['lifecycle.archivedAt'], legacyArchivedAt);
});

test('não reancora arquivo que já possui archivedAt', () => {
  const plan = buildCommunityArchiveRetentionAnchorPlan(
    community({
      status: 'archived',
      lifecycle: {
        lastMeaningfulActivityAt: NOW - 400 * DAY_MS,
        archivedAt: NOW - 100 * DAY_MS,
      },
    }),
    NOW
  );

  assert.equal(plan, null);
});

test('plano de dormência preserva a atividade real anterior ao update do cron', () => {
  const raw = community({
    lifecycle: { lastMeaningfulActivityAt: NOW - 70 * DAY_MS },
  });
  const decision = evaluateCommunityLifecycle(raw, NOW);
  const plan = buildCommunityLifecycleMutationPlan(raw, decision, NOW);

  assert.ok(plan);
  assert.equal(plan.communityPatch['status'], 'dormant');
  assert.equal(plan.communityPatch['lifecycle.dormantAt'], NOW);
  assert.equal(
    plan.communityPatch['lifecycle.lastMeaningfulActivityAt'],
    NOW - 70 * DAY_MS
  );
  assert.equal(plan.discoveryPatch['status'], 'dormant');
});

test('plano de reativação limpa marcadores antigos e renova ranking', () => {
  const raw = community({
    status: 'dormant',
    lifecycle: {
      lastMeaningfulActivityAt: NOW - 2 * DAY_MS,
      dormantAt: NOW - 70 * DAY_MS,
      archivedAt: null,
    },
  });
  const decision = evaluateCommunityLifecycle(raw, NOW);
  const plan = buildCommunityLifecycleMutationPlan(raw, decision, NOW);

  assert.ok(plan);
  assert.equal(plan.communityPatch['status'], 'active');
  assert.equal(plan.communityPatch['lifecycle.dormantAt'], null);
  assert.equal(plan.communityPatch['lifecycle.archivedAt'], null);
  assert.equal(plan.discoveryPatch['status'], 'active');
  assert.equal(plan.discoveryPatch['rankScore'], NOW);
});

test('plano de arquivamento mantém âncora canônica e compatibilidade legada', () => {
  const raw = community({
    status: 'dormant',
    metrics: { memberCount: 0, postCount: 1, mediaCount: 0, topicCount: 0 },
    lifecycle: { lastMeaningfulActivityAt: NOW - 150 * DAY_MS },
  });
  const decision = evaluateCommunityLifecycle(raw, NOW);
  const plan = buildCommunityLifecycleMutationPlan(raw, decision, NOW);

  assert.ok(plan);
  assert.equal(plan.communityPatch['status'], 'archived');
  assert.equal(plan.communityPatch['archivedAt'], NOW);
  assert.equal(plan.communityPatch['lifecycle.archivedAt'], NOW);
});

test('plano de agendamento nunca contém operação de exclusão física', () => {
  const raw = community({
    status: 'archived',
    metrics: { memberCount: 0, postCount: 0, mediaCount: 0, topicCount: 0 },
    lifecycle: {
      lastMeaningfulActivityAt: NOW - 400 * DAY_MS,
      archivedAt: NOW - 100 * DAY_MS,
    },
  });
  const decision = evaluateCommunityLifecycle(raw, NOW);
  const plan = buildCommunityLifecycleMutationPlan(raw, decision, NOW);

  assert.ok(plan);
  assert.equal(plan.communityPatch['status'], 'scheduled_for_deletion');
  assert.equal(plan.discoveryPatch['status'], 'scheduled_for_deletion');
  assert.equal('delete' in plan.communityPatch, false);
});
