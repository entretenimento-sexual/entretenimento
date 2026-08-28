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
import {
  evaluateCommunityPurgeReadiness,
  resolveCommunityPurgeGraceDays,
} from './community-purge.policy';

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

function purgeCandidate(overrides: Record<string, unknown> = {}) {
  return community({
    status: 'scheduled_for_deletion',
    metrics: { memberCount: 0, postCount: 0, mediaCount: 0, topicCount: 0 },
    lifecycle: {
      lastMeaningfulActivityAt: NOW - 500 * DAY_MS,
      archivedAt: NOW - 120 * DAY_MS,
      scheduledForDeletionAt: NOW - 40 * DAY_MS,
    },
    ...overrides,
  });
}

const EMPTY_PURGE_EVIDENCE = {
  hasLiveMemberships: false,
  hasRetainedContent: false,
  hasModerationEvidence: false,
} as const;

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

test('purge exige período de graça configurável e limitado', () => {
  assert.equal(resolveCommunityPurgeGraceDays({}), 30);
  assert.equal(resolveCommunityPurgeGraceDays({ lifecyclePurgeGraceDays: 1 }), 7);
  assert.equal(
    resolveCommunityPurgeGraceDays({ lifecyclePurgeGraceDays: 999 }),
    365
  );
});

test('purge autoriza apenas Comunidade vazia, sem evidência e após a graça', () => {
  const decision = evaluateCommunityPurgeReadiness(
    purgeCandidate(),
    EMPTY_PURGE_EVIDENCE,
    NOW,
    30
  );

  assert.equal(decision.eligible, true);
  assert.equal(decision.denialReason, null);
  assert.equal(decision.purgeEligibleAt, NOW - 10 * DAY_MS);
});

test('purge bloqueia Local, owner residual, membros e métricas desconhecidas', () => {
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate({ source: { type: 'venue', id: 'venue-1' } }),
      EMPTY_PURGE_EVIDENCE,
      NOW
    ).denialReason,
    'not_community'
  );
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate({ ownerUid: 'owner-1' }),
      EMPTY_PURGE_EVIDENCE,
      NOW
    ).denialReason,
    'ownership_not_released'
  );
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate({ metrics: {} }),
      EMPTY_PURGE_EVIDENCE,
      NOW
    ).denialReason,
    'member_count_unknown'
  );
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate({
        metrics: { memberCount: 1, postCount: 0, mediaCount: 0, topicCount: 0 },
      }),
      EMPTY_PURGE_EVIDENCE,
      NOW
    ).denialReason,
    'members_present'
  );
});

test('purge falha fechado sem prova sobre memberships, conteúdo e moderação', () => {
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate(),
      { ...EMPTY_PURGE_EVIDENCE, hasLiveMemberships: null },
      NOW
    ).denialReason,
    'membership_probe_unknown'
  );
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate(),
      { ...EMPTY_PURGE_EVIDENCE, hasRetainedContent: null },
      NOW
    ).denialReason,
    'content_probe_unknown'
  );
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate(),
      { ...EMPTY_PURGE_EVIDENCE, hasModerationEvidence: null },
      NOW
    ).denialReason,
    'moderation_evidence_probe_unknown'
  );
});

test('purge bloqueia qualquer vínculo, conteúdo ou evidência de moderação', () => {
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate(),
      { ...EMPTY_PURGE_EVIDENCE, hasLiveMemberships: true },
      NOW
    ).denialReason,
    'live_memberships_present'
  );
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate(),
      { ...EMPTY_PURGE_EVIDENCE, hasRetainedContent: true },
      NOW
    ).denialReason,
    'retained_content_present'
  );
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate(),
      { ...EMPTY_PURGE_EVIDENCE, hasModerationEvidence: true },
      NOW
    ).denialReason,
    'moderation_evidence_present'
  );
});

test('purge respeita hold, timestamp canônico e período de graça', () => {
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate({ lifecycle: { retentionHold: true } }),
      EMPTY_PURGE_EVIDENCE,
      NOW
    ).denialReason,
    'retention_hold'
  );
  assert.equal(
    evaluateCommunityPurgeReadiness(
      purgeCandidate({ lifecycle: { scheduledForDeletionAt: null } }),
      EMPTY_PURGE_EVIDENCE,
      NOW
    ).denialReason,
    'scheduled_at_unknown'
  );

  const waiting = evaluateCommunityPurgeReadiness(
    purgeCandidate({
      lifecycle: {
        scheduledForDeletionAt: NOW - 10 * DAY_MS,
      },
    }),
    EMPTY_PURGE_EVIDENCE,
    NOW,
    30
  );
  assert.equal(waiting.denialReason, 'grace_period_not_elapsed');
  assert.equal(waiting.purgeEligibleAt, NOW + 20 * DAY_MS);
});
