import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityReactionNotificationCopy,
  buildCommunityReactionNotificationId,
} from './community-notification.policy';
import { collectCommunityMyPageIncrementally } from './community-my-page-scan.policy';
import { buildCommunityDiscoveryTelemetry } from './community-discovery-telemetry.policy';
import {
  COMMUNITY_OPERATIONAL_COST_BUDGETS,
  estimateExposureWritesPerAcceptedExposure,
  evaluateOperationalCostBudget,
} from '../shared/observability/operational-cost-budget.policy';
import {
  MAX_PUSH_DEVICES_PER_USER,
  resolvePushDeliveryTargets,
} from '../notifications/push-device.policy';

const COMMUNITY_COUNTS = [1, 5, 20, 100] as const;
const PAGE_SIZE = 12;
const HOT_EVENT_COUNT = 1_000;
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);

interface SyntheticCommunityDocument {
  readonly id: number;
}

async function paginateAllCommunities(
  total: number
): Promise<{ ids: string[]; pages: number }> {
  const documents = Array.from(
    { length: total },
    (_, index): SyntheticCommunityDocument => ({ id: index + 1 })
  );
  const ids: string[] = [];
  let pages = 0;
  let externalCursor: SyntheticCommunityDocument | null = null;

  while (ids.length < total) {
    const page = await collectCommunityMyPageIncrementally({
      limit: PAGE_SIZE,
      loadBatch: async (afterDocument, limit) => {
        const cursor = afterDocument ?? externalCursor;
        const startIndex = cursor
          ? documents.findIndex((document) => document.id === cursor.id) + 1
          : 0;
        return documents.slice(startIndex, startIndex + limit);
      },
      validateDocuments: async (batch) =>
        batch.map((document) => `community-${document.id}`),
    });

    pages += 1;
    ids.push(...page.items);

    if (!page.lastConsumedDocument || !page.mayHaveAnotherPage) {
      externalCursor = page.lastConsumedDocument;
      break;
    }

    externalCursor = page.lastConsumedDocument;
  }

  return { ids, pages };
}

for (const communityCount of COMMUNITY_COUNTS) {
  test(`pagina Minhas Comunidades integralmente no cenário sintético de ${communityCount}`, async () => {
    const result = await paginateAllCommunities(communityCount);

    assert.equal(result.ids.length, communityCount);
    assert.equal(new Set(result.ids).size, communityCount);
    assert.equal(result.pages, Math.ceil(communityCount / PAGE_SIZE));
    assert.equal(result.ids[0], 'community-1');
    assert.equal(result.ids.at(-1), `community-${communityCount}`);
  });
}

test('comunidade quente agrupa 1.000 reações no mesmo envelope diário', () => {
  const ids = new Set<string>();
  let existingActivityCount = 0;

  for (let index = 0; index < HOT_EVENT_COUNT; index += 1) {
    ids.add(buildCommunityReactionNotificationId(
      'community-hot',
      'post-hot',
      'recipient-1',
      NOW - 60_000,
      NOW + index * 1_000
    ));

    existingActivityCount = buildCommunityReactionNotificationCopy({
      existingActivityCount,
      communityName: 'Comunidade quente',
    }).activityCount;
  }

  assert.equal(ids.size, 1);
  assert.equal(existingActivityCount, HOT_EVENT_COUNT);
});

test('fan-out de push permanece deduplicado, limitado e observável', () => {
  const registry = Array.from(
    { length: MAX_PUSH_DEVICES_PER_USER },
    (_, index) => ({
      documentId: `device-${index + 1}`,
      token: `synthetic-push-token-${index + 1}-${'x'.repeat(28)}`,
    })
  );

  const targets = resolvePushDeliveryTargets([
    ...registry,
    { documentId: 'duplicate-device', token: registry[0]?.token },
    { documentId: 'invalid-device', token: 'short' },
  ]);

  assert.equal(MAX_PUSH_DEVICES_PER_USER, 10);
  assert.equal(targets.length, MAX_PUSH_DEVICES_PER_USER);
  assert.equal(targets[0]?.registryDocumentIds.length, 2);

  const normal = evaluateOperationalCostBudget(
    'community.notification.push_targets_per_notification',
    3
  );
  const pathologicalButBounded = evaluateOperationalCostBudget(
    'community.notification.push_targets_per_notification',
    targets.length
  );

  assert.equal(normal.status, 'within');
  assert.equal(pathologicalButBounded.status, 'critical');
});

test('paginação saudável de discovery fica dentro do envelope de reads/card', () => {
  for (const hasCursor of [false, true]) {
    const telemetry = buildCommunityDiscoveryTelemetry({
      requestedLimit: PAGE_SIZE,
      scanLimit: PAGE_SIZE * 3 + 1,
      projectionDocumentsFetched: PAGE_SIZE + 1,
      projectionDocumentsConsumed: PAGE_SIZE,
      candidatesEvaluated: PAGE_SIZE,
      membershipReads: PAGE_SIZE,
      membershipBatches: 1,
      blockedExcluded: 0,
      cardsReturned: PAGE_SIZE,
      cursorProjectionReads: hasCursor ? 1 : 0,
      durationMs: 25,
      hasCursor,
      hasTagFilter: false,
      sourceType: 'community',
      rankingMode: 'score_v2',
      hasNextPage: true,
    });
    const value = Number(telemetry['totalReadAmplificationUpperBound']);
    const observation = evaluateOperationalCostBudget(
      'community.discovery.reads_per_card',
      value
    );

    assert.equal(observation.status, 'within');
    assert.ok(
      value <= COMMUNITY_OPERATIONAL_COST_BUDGETS[
        'community.discovery.reads_per_card'
      ].targetMax
    );
  }
});

test('lote normal de exposure mantém write amplification no target técnico', () => {
  const value = estimateExposureWritesPerAcceptedExposure({ accepted: 12 });
  assert.equal(value, 1.08);

  const observation = evaluateOperationalCostBudget(
    'community.discovery.exposure_writes_per_accepted',
    value ?? 0
  );

  assert.equal(observation.status, 'within');
  assert.ok(
    (value ?? Infinity) <= COMMUNITY_OPERATIONAL_COST_BUDGETS[
      'community.discovery.exposure_writes_per_accepted'
    ].targetMax
  );
});
