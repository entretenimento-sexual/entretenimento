import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const contractPath = path.join(root, 'ops', 'monitoring', 'community-cost', 'contract.json');
const budgetPath = path.join(
  root,
  'functions',
  'src',
  'shared',
  'observability',
  'operational-cost-budget.policy.ts'
);
const baselinePath = path.join(
  root,
  'functions',
  'src',
  'shared',
  'observability',
  'operational-cost-baseline.policy.ts'
);
const businessCalibrationPath = path.join(
  root,
  'functions',
  'src',
  'community',
  'community-business-official-calibration.policy.ts'
);
const boostCalibrationPath = path.join(
  root,
  'functions',
  'src',
  'community-boost',
  'community-boost-cost-calibration.policy.ts'
);

for (const file of [
  contractPath,
  budgetPath,
  baselinePath,
  businessCalibrationPath,
  boostCalibrationPath,
]) {
  if (!fs.existsSync(file)) {
    throw new Error('Community cost operations file missing: ' + file);
  }
}

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const budgetSource = fs.readFileSync(budgetPath, 'utf8');
const baselineSource = fs.readFileSync(baselinePath, 'utf8');
const businessSource = fs.readFileSync(businessCalibrationPath, 'utf8');
const boostSource = fs.readFileSync(boostCalibrationPath, 'utf8');

if (contract.version !== 1 || !Array.isArray(contract.metrics)) {
  throw new Error('Community cost monitoring contract version/metrics invalid.');
}

const keys = contract.metrics.map((metric) => metric.key);
if (new Set(keys).size !== keys.length) {
  throw new Error('Community cost monitoring metric keys must be unique.');
}

const requiredRealMetrics = [
  'community.discovery.reads_per_card',
  'community.discovery.exposure_writes_per_accepted',
  'community.notification.push_targets_per_notification',
  'community.storage.upper_bound_bytes_per_community',
  'community.boost.reads_proxy_per_served_placement',
  'community.boost.writes_proxy_per_served_placement',
];

for (const key of requiredRealMetrics) {
  if (!keys.includes(key)) {
    throw new Error('Missing real cost metric in monitoring contract: ' + key);
  }
  if (!baselineSource.includes("'" + key + "'")) {
    throw new Error('Missing real cost metric in baseline policy: ' + key);
  }
}

if (keys.includes('community.discovery.callables_per_session')) {
  throw new Error(
    'Synthetic callables/session must not be presented as a real production baseline.'
  );
}

for (const metric of contract.metrics.filter((item) => item.budgeted === true)) {
  const anchor = "'" + metric.key + "': Object.freeze({";
  const start = budgetSource.indexOf(anchor);
  if (start < 0) {
    throw new Error('Budget definition missing for ' + metric.key);
  }
  const end = budgetSource.indexOf('\n  }),', start);
  if (end < 0) {
    throw new Error('Budget definition block is malformed for ' + metric.key);
  }
  const block = budgetSource.slice(start, end);

  for (const [field, value] of [
    ['warningAbove', metric.warningAbove],
    ['criticalAbove', metric.criticalAbove],
    ['minimumSamples', metric.minimumSamples],
  ]) {
    if (!block.includes(field + ': ' + value)) {
      throw new Error(
        'Monitoring contract drift for '
        + metric.key
        + ': '
        + field
        + '='
        + value
      );
    }
  }
}

for (const required of [
  'operational_baseline_not_ready',
  'evaluateCommunityOperationalCostBaseline',
]) {
  if (!businessSource.includes(required)) {
    throw new Error(
      'Business/Official calibration must remain gated by real baseline: '
      + required
    );
  }
  if (!boostSource.includes(required)) {
    throw new Error(
      'Boost calibration must remain gated by real baseline: '
      + required
    );
  }
}

console.log(
  '[community-cost-operations] OK: monitoring, real baseline and commercial calibration gates are aligned.'
);
