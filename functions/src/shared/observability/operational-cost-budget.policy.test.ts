import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_OPERATIONAL_COST_BUDGETS,
  estimateCommunityStorageUpperBoundBytes,
  estimateExposureWritesPerAcceptedExposure,
  evaluateOperationalCostBudget,
  isOperationalCostBudgetAlert,
} from './operational-cost-budget.policy';

test('mantém orçamento canônico das cinco dimensões de Comunidades', () => {
  assert.deepEqual(
    Object.keys(COMMUNITY_OPERATIONAL_COST_BUDGETS).sort(),
    [
      'community.discovery.callables_per_session',
      'community.discovery.exposure_writes_per_accepted',
      'community.discovery.reads_per_card',
      'community.notification.push_targets_per_notification',
      'community.storage.upper_bound_bytes_per_community',
    ]
  );
});

test('classifica warning e critical somente acima dos thresholds', () => {
  const metric = 'community.discovery.reads_per_card' as const;
  const definition = COMMUNITY_OPERATIONAL_COST_BUDGETS[metric];

  assert.equal(
    evaluateOperationalCostBudget(metric, definition.warningAbove).status,
    'within'
  );
  assert.equal(
    evaluateOperationalCostBudget(metric, definition.warningAbove + 0.01).status,
    'warning'
  );
  assert.equal(
    evaluateOperationalCostBudget(metric, definition.criticalAbove).status,
    'warning'
  );
  const critical = evaluateOperationalCostBudget(
    metric,
    definition.criticalAbove + 0.01
  );
  assert.equal(critical.status, 'critical');
  assert.equal(isOperationalCostBudgetAlert(critical), true);
});

test('marca métricas server-side como observáveis sem I/O adicional', () => {
  for (const [metric, budget] of Object.entries(
    COMMUNITY_OPERATIONAL_COST_BUDGETS
  )) {
    if (metric === 'community.discovery.callables_per_session') continue;
    assert.equal(budget.measurementSource, 'runtime_log');
  }
});

test('estima writes de exposure incluindo o write de quota por lote', () => {
  assert.equal(
    estimateExposureWritesPerAcceptedExposure({ accepted: 12 }),
    1.08
  );
  assert.equal(
    estimateExposureWritesPerAcceptedExposure({ accepted: 4 }),
    1.25
  );
  assert.equal(
    estimateExposureWritesPerAcceptedExposure({ accepted: 1 }),
    2
  );
  assert.equal(
    estimateExposureWritesPerAcceptedExposure({ accepted: 0 }),
    null
  );
});

test('estima storage de Comunidade sem adicionar leitura de inventário', () => {
  const tenMiB = 10 * 1024 * 1024;
  assert.equal(
    estimateCommunityStorageUpperBoundBytes({
      mediaCount: 25,
      maxAssetBytes: tenMiB,
    }),
    250 * 1024 * 1024
  );
});

test('orçamento de callables por sessão é alerta agregado, não identificador servidor', () => {
  const budget =
    COMMUNITY_OPERATIONAL_COST_BUDGETS[
      'community.discovery.callables_per_session'
    ];

  assert.equal(budget.targetMax, 4);
  assert.equal(budget.measurementSource, 'client_synthetic');
  assert.equal(budget.aggregation, 'p95');
  assert.equal(budget.windowMinutes, 60);
  assert.match(budget.semantics, /do not add server session identifiers/);
});
