// functions/src/community/community-lifecycle.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS,
  evaluateCommunityLifecycle,
  hasCommunityLifecycleHold,
  isCommunityMemberActivityEnabledStatus,
  isCommunityMembershipManagementEnabledStatus,
  requiresCommunityLifecycleMembershipVerification,
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


test('falha fechado para status ausente, nulo, desconhecido ou inválido', () => {
  const absentStatus = community({
    metrics: { memberCount: 0, postCount: 0, mediaCount: 0, topicCount: 0 },
    lifecycle: { lastMeaningfulActivityAt: NOW - 500 * DAY_MS },
  });
  delete absentStatus['status'];

  const invalidCommunities = [
    absentStatus,
    community({ status: null }),
    community({ status: 'corrupted-status' }),
    community({ status: 123 }),
  ];

  for (const rawCommunity of invalidCommunities) {
    const decision = evaluateCommunityLifecycle(rawCommunity, NOW);

    assert.equal(decision.changed, false);
    assert.equal(decision.currentStatus, null);
    assert.equal(decision.nextStatus, null);
    assert.equal(decision.reason, 'status_invalid');
    assert.equal(
      requiresCommunityLifecycleMembershipVerification(rawCommunity, NOW),
      false
    );
  }
});

test('preserva os cinco estados canônicos do lifecycle', () => {
  const cases = [
    ['active', NOW - 5 * DAY_MS],
    ['paused', NOW - 5 * DAY_MS],
    ['dormant', NOW - 70 * DAY_MS],
    ['archived', NOW - 200 * DAY_MS],
    ['scheduled_for_deletion', NOW - 200 * DAY_MS],
  ] as const;

  for (const [status, lastMeaningfulActivityAt] of cases) {
    const decision = evaluateCommunityLifecycle(
      community({
        status,
        lifecycle: { lastMeaningfulActivityAt },
      }),
      NOW
    );

    assert.equal(decision.currentStatus, status);
    assert.equal(decision.nextStatus, status);
    assert.equal(decision.changed, false);
  }
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

test('ocupação canônica bloqueia arquivo vazio quando memberCount está stale em zero', () => {
  const result = evaluateCommunityLifecycle(
    community({
      metrics: { memberCount: 0, postCount: 0, mediaCount: 0, topicCount: 0 },
      lifecycle: {
        lastMeaningfulActivityAt:
          NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyArchiveAfterDays * DAY_MS,
      },
    }),
    NOW,
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS,
    'nonempty'
  );

  assert.equal(result.changed, false);
  assert.equal(result.nextStatus, 'active');
});

test('vazio canônico permite arquivo mesmo com memberCount stale positivo', () => {
  const rawCommunity = community({
    metrics: { memberCount: 12, postCount: 0, mediaCount: 0, topicCount: 0 },
    lifecycle: {
      lastMeaningfulActivityAt:
        NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyArchiveAfterDays * DAY_MS,
    },
  });

  assert.equal(
    requiresCommunityLifecycleMembershipVerification(rawCommunity, NOW),
    true
  );

  const result = evaluateCommunityLifecycle(
    rawCommunity,
    NOW,
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS,
    'empty'
  );

  assert.equal(result.nextStatus, 'archived');
  assert.equal(result.reason, 'empty_and_inactive');
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

test('dormant só arquiva após janela máxima com vazio canônico', () => {
  const rawCommunity = community({
    status: 'dormant',
    metrics: {
      memberCount: 10,
      postCount: 4,
      mediaCount: 2,
      topicCount: 1,
    },
    lifecycle: {
      lastMeaningfulActivityAt:
        NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.archiveAfterDays * DAY_MS,
    },
  });

  const projected = evaluateCommunityLifecycle(rawCommunity, NOW);
  assert.equal(projected.changed, false);
  assert.equal(projected.nextStatus, 'dormant');

  assert.equal(
    requiresCommunityLifecycleMembershipVerification(rawCommunity, NOW),
    true
  );

  const nonempty = evaluateCommunityLifecycle(
    rawCommunity,
    NOW,
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS,
    'nonempty'
  );
  assert.equal(nonempty.changed, false);
  assert.equal(nonempty.nextStatus, 'dormant');

  const empty = evaluateCommunityLifecycle(
    rawCommunity,
    NOW,
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS,
    'empty'
  );
  assert.equal(empty.changed, true);
  assert.equal(empty.nextStatus, 'archived');
  assert.equal(empty.reason, 'empty_and_inactive');
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

test('ocupação canônica bloqueia exclusão quando arquivo aponta memberCount zero stale', () => {
  const rawCommunity = community({
    status: 'archived',
    metrics: { memberCount: 0, postCount: 0, mediaCount: 0, topicCount: 0 },
    lifecycle: {
      archivedAt:
        NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyDeletionAfterDays * DAY_MS,
      lastMeaningfulActivityAt: NOW - 200 * DAY_MS,
    },
  });

  assert.equal(
    requiresCommunityLifecycleMembershipVerification(rawCommunity, NOW),
    true
  );

  const result = evaluateCommunityLifecycle(
    rawCommunity,
    NOW,
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS,
    'nonempty'
  );

  assert.equal(result.changed, false);
  assert.equal(result.nextStatus, 'archived');
});

test('vazio canônico libera retenção vencida mesmo com memberCount stale positivo', () => {
  const rawCommunity = community({
    status: 'archived',
    metrics: { memberCount: 8, postCount: 0, mediaCount: 0, topicCount: 0 },
    lifecycle: {
      archivedAt:
        NOW - DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyDeletionAfterDays * DAY_MS,
      lastMeaningfulActivityAt: NOW - 200 * DAY_MS,
    },
  });

  assert.equal(
    requiresCommunityLifecycleMembershipVerification(rawCommunity, NOW),
    true
  );

  const result = evaluateCommunityLifecycle(
    rawCommunity,
    NOW,
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS,
    'empty'
  );

  assert.equal(result.nextStatus, 'scheduled_for_deletion');
  assert.equal(result.reason, 'empty_archive_expired');
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

test('métrica de membros ausente nunca autoriza transição destrutiva sem prova canônica', () => {
  const rawCommunity = community({
    status: 'archived',
    metrics: { postCount: 0, mediaCount: 0, topicCount: 0 },
    lifecycle: {
      archivedAt: NOW - 500 * DAY_MS,
      lastMeaningfulActivityAt: NOW - 500 * DAY_MS,
    },
  });
  const result = evaluateCommunityLifecycle(rawCommunity, NOW);

  assert.equal(result.changed, false);
  assert.equal(result.nextStatus, 'archived');
  assert.equal(
    requiresCommunityLifecycleMembershipVerification(rawCommunity, NOW),
    true
  );

  const canonicalEmpty = evaluateCommunityLifecycle(
    rawCommunity,
    NOW,
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS,
    'empty'
  );
  assert.equal(canonicalEmpty.nextStatus, 'scheduled_for_deletion');
});

test('não consulta ocupação canônica quando lifecycle não depende de vazio', () => {
  assert.equal(
    requiresCommunityLifecycleMembershipVerification(
      community({
        lifecycle: { lastMeaningfulActivityAt: NOW - 5 * DAY_MS },
      }),
      NOW
    ),
    false
  );

  assert.equal(
    requiresCommunityLifecycleMembershipVerification(
      community({
        status: 'dormant',
        lifecycle: {
          lastMeaningfulActivityAt:
            NOW - (DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.archiveAfterDays - 1) * DAY_MS,
        },
      }),
      NOW
    ),
    false
  );
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
