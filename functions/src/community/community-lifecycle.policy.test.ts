// functions/src/community/community-lifecycle.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS,
  evaluateCommunityLifecycle,
  hasCommunityLifecycleHold,
  isCommunityMemberActivityEnabledStatus,
  isCommunityMembershipManagementEnabledStatus,
} from './community-lifecycle.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

function community(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: { type: 'community', id: 'community-1' },
    status: 'active',
    moderation: { state: 'active' },
    metrics: { memberCount: 10, postCount: 4, mediaCount: 2, topicCount: 1 },
    lifecycle: {
      lastMeaningfulActivityAt: NOW - 10 * DAY_MS,
      retentionHold: false,
    },
    createdAt: NOW - 200 * DAY_MS,
    updatedAt: NOW - 10 * DAY_MS,
    ...overrides,
  };
}

test('atividade de membros pode reanimar active/dormant sem abrir gestão em dormant', () => {
  assert.equal(isCommunityMemberActivityEnabledStatus('active'), true);
  assert.equal(isCommunityMemberActivityEnabledStatus('dormant'), true);
  assert.equal(isCommunityMemberActivityEnabledStatus('paused'), false);
  assert.equal(isCommunityMemberActivityEnabledStatus('archived'), false);
  assert.equal(isCommunityMemberActivityEnabledStatus('scheduled_for_deletion'), false);

  assert.equal(isCommunityMembershipManagementEnabledStatus('active'), true);
  assert.equal(isCommunityMembershipManagementEnabledStatus('paused'), true);
  assert.equal(isCommunityMembershipManagementEnabledStatus('dormant'), false);
  assert.equal(isCommunityMembershipManagementEnabledStatus('archived'), false);
});

test('não aplica lifecycle de Comunidade a Local', () => {
  const result = evaluateCommunityLifecycle(
    community({ source: { type: 'venue', id: 'venue-1' } }),
    NOW
  );

  assert.equal(result.changed, false);
  assert.equal(result.reason, 'not_community');
});

test('arquiva automaticamente Comunidade vazia e inativa com métricas completas', () => {
  const result = evaluateCommunityLifecycle(
    community({
      metrics: { memberCount: 0, postCount: 0, mediaCount: 0, topicCount: 0 },
      lifecycle: {
        lastMeaningfulActivityAt:
          NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyArchiveAfterDays * DAY_MS,
      },
    }),
    NOW
  );

  assert.equal(result.nextStatus, 'archived');
  assert.equal(result.reason, 'empty_and_inactive');
  assert.equal(result.shouldHideFromDiscovery, true);
});

test('métrica de conteúdo incompleta não classifica Comunidade como vazia no prazo curto', () => {
  const result = evaluateCommunityLifecycle(
    community({
      metrics: { memberCount: 0, postCount: 0, mediaCount: 0 },
      lifecycle: {
        lastMeaningfulActivityAt:
          NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyArchiveAfterDays * DAY_MS,
      },
    }),
    NOW
  );

  assert.equal(result.changed, false);
  assert.equal(result.nextStatus, 'active');
});

test('marca como dormente quando há integrantes mas a atividade cessou', () => {
  const result = evaluateCommunityLifecycle(
    community({
      lifecycle: {
        lastMeaningfulActivityAt:
          NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.dormantAfterDays * DAY_MS,
      },
    }),
    NOW
  );

  assert.equal(result.nextStatus, 'dormant');
  assert.equal(result.reason, 'inactive');
});

test('reativa Comunidade dormente quando atividade significativa volta', () => {
  const result = evaluateCommunityLifecycle(
    community({
      status: 'dormant',
      lifecycle: { lastMeaningfulActivityAt: NOW - 2 * DAY_MS },
    }),
    NOW
  );

  assert.equal(result.nextStatus, 'active');
  assert.equal(result.reason, 'meaningful_activity_resumed');
});

test('aceita Firestore Timestamp como atividade significativa', () => {
  const recentTimestamp = {
    toMillis: () => NOW - 2 * DAY_MS,
  };
  const result = evaluateCommunityLifecycle(
    community({
      status: 'dormant',
      lifecycle: { lastMeaningfulActivityAt: recentTimestamp },
    }),
    NOW
  );

  assert.equal(result.nextStatus, 'active');
  assert.equal(result.reason, 'meaningful_activity_resumed');
});

test('arquiva Comunidade dormente depois da janela máxima de inatividade', () => {
  const result = evaluateCommunityLifecycle(
    community({
      status: 'dormant',
      lifecycle: {
        lastMeaningfulActivityAt:
          NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.archiveAfterDays * DAY_MS,
      },
    }),
    NOW
  );

  assert.equal(result.nextStatus, 'archived');
});

test('agenda exclusão de arquivo vazio somente depois da retenção mínima', () => {
  const result = evaluateCommunityLifecycle(
    community({
      status: 'archived',
      metrics: { memberCount: 0, postCount: 0, mediaCount: 0, topicCount: 0 },
      lifecycle: {
        archivedAt:
          NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyDeletionAfterDays * DAY_MS,
        lastMeaningfulActivityAt: NOW - 200 * DAY_MS,
      },
    }),
    NOW
  );

  assert.equal(result.nextStatus, 'scheduled_for_deletion');
  assert.equal(result.reason, 'empty_archive_expired');
  assert.equal(result.deletionEligibleAt, NOW);
});

test('métrica de tópico legada ausente usa retenção longa em vez de considerar arquivo vazio', () => {
  const result = evaluateCommunityLifecycle(
    community({
      status: 'archived',
      metrics: { memberCount: 0, postCount: 0, mediaCount: 0 },
      lifecycle: {
        archivedAt:
          NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyDeletionAfterDays * DAY_MS,
        lastMeaningfulActivityAt: NOW - 200 * DAY_MS,
      },
    }),
    NOW
  );

  assert.equal(result.changed, false);
  assert.equal(result.nextStatus, 'archived');
});

test('preserva por mais tempo conteúdo histórico sem integrantes', () => {
  const result = evaluateCommunityLifecycle(
    community({
      status: 'archived',
      metrics: { memberCount: 0, postCount: 8, mediaCount: 1, topicCount: 0 },
      lifecycle: {
        archivedAt:
          NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyDeletionAfterDays * DAY_MS,
        lastMeaningfulActivityAt: NOW - 200 * DAY_MS,
      },
    }),
    NOW
  );

  assert.equal(result.changed, false);
  assert.equal(result.nextStatus, 'archived');
});

test('Tópicos persistidos entram na retenção longa de conteúdo histórico', () => {
  const result = evaluateCommunityLifecycle(
    community({
      status: 'archived',
      metrics: { memberCount: 0, postCount: 0, mediaCount: 0, topicCount: 1 },
      lifecycle: {
        archivedAt:
          NOW
          - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.orphanedContentDeletionAfterDays
          * DAY_MS,
        lastMeaningfulActivityAt: NOW - 500 * DAY_MS,
      },
    }),
    NOW
  );

  assert.equal(result.nextStatus, 'scheduled_for_deletion');
  assert.equal(result.reason, 'orphaned_content_archive_expired');
});

test('métrica de membros ausente nunca autoriza transição destrutiva', () => {
  const result = evaluateCommunityLifecycle(
    community({
      status: 'archived',
      metrics: { postCount: 0, mediaCount: 0, topicCount: 0 },
      lifecycle: {
        archivedAt: NOW - 500 * DAY_MS,
        lastMeaningfulActivityAt: NOW - 500 * DAY_MS,
      },
    }),
    NOW
  );

  assert.equal(result.changed, false);
  assert.equal(result.nextStatus, 'archived');
});

test('normaliza os aliases de retenção e legal hold em uma única policy', () => {
  assert.equal(
    hasCommunityLifecycleHold({
      moderation: { state: 'active', retentionHold: true },
    }),
    true
  );
  assert.equal(
    hasCommunityLifecycleHold({
      moderation: { state: 'active', legalHold: true },
    }),
    true
  );
  assert.equal(
    hasCommunityLifecycleHold({
      moderation: { state: 'active' },
      lifecycle: { retentionHold: true },
    }),
    true
  );
  assert.equal(
    hasCommunityLifecycleHold({
      moderation: { state: 'active' },
      lifecycle: { hold: true },
    }),
    true
  );
  assert.equal(
    hasCommunityLifecycleHold({
      moderation: { state: 'active' },
      legalHold: true,
    }),
    true
  );
  assert.equal(
    hasCommunityLifecycleHold({ moderation: { state: 'hidden' } }),
    true
  );
});

test('retenção de moderação impede qualquer transição destrutiva', () => {
  const result = evaluateCommunityLifecycle(
    community({
      status: 'archived',
      metrics: { memberCount: 0, postCount: 0, mediaCount: 0, topicCount: 0 },
      lifecycle: {
        archivedAt: NOW - 400 * DAY_MS,
        lastMeaningfulActivityAt: NOW - 400 * DAY_MS,
        retentionHold: true,
      },
    }),
    NOW
  );

  assert.equal(result.changed, false);
  assert.equal(result.reason, 'moderation_hold');
});

test('estado paused continua fora da automação de inatividade', () => {
  const result = evaluateCommunityLifecycle(
    community({ status: 'paused' }),
    NOW
  );

  assert.equal(result.changed, false);
  assert.equal(result.reason, 'status_not_managed');
});
