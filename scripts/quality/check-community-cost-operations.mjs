import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
const applyMonitoringPath = path.join(
  root,
  'scripts',
  'admin',
  'apply-community-cost-monitoring.mjs'
);
const captureBaselinePath = path.join(
  root,
  'scripts',
  'admin',
  'capture-community-cost-baseline.mjs'
);
const monitoringWorkflowPath = path.join(
  root,
  '.github',
  'workflows',
  'community-cost-monitoring-production.yml'
);
const baselineWorkflowPath = path.join(
  root,
  '.github',
  'workflows',
  'community-cost-baseline-production.yml'
);
const gcpBootstrapPath = path.join(
  root,
  'scripts',
  'admin',
  'bootstrap-community-cost-gcp.mjs'
);
const notificationChannelPath = path.join(
  root,
  'scripts',
  'admin',
  'create-community-cost-notification-channel.mjs'
);
const communitySearchHandlerPath = path.join(
  root,
  'functions',
  'src',
  'community',
  'get-community-search-page.handler.ts'
);
const communitySearchComponentPath = path.join(
  root,
  'src',
  'app',
  'community',
  'search',
  'community-search.component.ts'
);

for (const file of [
  contractPath,
  budgetPath,
  baselinePath,
  businessCalibrationPath,
  boostCalibrationPath,
  applyMonitoringPath,
  captureBaselinePath,
  monitoringWorkflowPath,
  baselineWorkflowPath,
  gcpBootstrapPath,
  notificationChannelPath,
  communitySearchHandlerPath,
  communitySearchComponentPath,
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
const monitoringWorkflowSource = fs.readFileSync(
  monitoringWorkflowPath,
  'utf8'
);
const baselineWorkflowSource = fs.readFileSync(
  baselineWorkflowPath,
  'utf8'
);
const communitySearchHandlerSource = fs.readFileSync(
  communitySearchHandlerPath,
  'utf8'
);
const communitySearchComponentSource = fs.readFileSync(
  communitySearchComponentPath,
  'utf8'
);

for (const required of [
  'const MAX_PAGE_LIMIT = 20',
  '.limit(scanLimit)',
  "'publicSearchPrefixes', 'array-contains'",
  "resolveBlockedTargetUids",
  "if (!input.activeMembership)",
]) {
  if (!communitySearchHandlerSource.includes(required)) {
    throw new Error(
      'Community internal search lost bounded/security invariant: ' + required
    );
  }
}

for (const required of [
  'debounceTime(250)',
  'canSearchMembers',
  "scope === 'members' && !canSearchMembers",
]) {
  if (!communitySearchComponentSource.includes(required)) {
    throw new Error(
      'Community internal search lost client cost invariant: ' + required
    );
  }
}

if (
  communitySearchHandlerSource.includes(
    ".collection('community_member_management_index').get()"
  )
  || communitySearchHandlerSource.includes(
    ".collection('community_public_topics').get()"
  )
) {
  throw new Error(
    'Community internal search must never scan an index collection without a bounded query.'
  );
}

for (const [name, workflow] of [
  ['monitoring', monitoringWorkflowSource],
  ['baseline', baselineWorkflowSource],
]) {
  for (const required of [
    'permissions:',
    'id-token: write',
    'google-github-actions/auth@v3',
    'google-github-actions/setup-gcloud@v3',
    'GCP_COMMUNITY_COST_WORKLOAD_IDENTITY_PROVIDER',
    "PROJECT_ID: 'entretenimento-sexual'",
  ]) {
    if (!workflow.includes(required)) {
      throw new Error(
        'Community cost ' + name + ' workflow missing: ' + required
      );
    }
  }

  if (workflow.includes('credentials_json')) {
    throw new Error(
      'Community cost workflows must use WIF/OIDC, not long-lived JSON keys.'
    );
  }
}

if (
  !monitoringWorkflowSource.includes(
    'GCP_COMMUNITY_COST_MONITORING_SERVICE_ACCOUNT'
  )
  || monitoringWorkflowSource.includes(
    'GCP_COMMUNITY_COST_BASELINE_SERVICE_ACCOUNT'
  )
) {
  throw new Error(
    'Monitoring workflow must use the dedicated monitoring service account.'
  );
}

if (
  !baselineWorkflowSource.includes(
    'GCP_COMMUNITY_COST_BASELINE_SERVICE_ACCOUNT'
  )
  || baselineWorkflowSource.includes(
    'GCP_COMMUNITY_COST_MONITORING_SERVICE_ACCOUNT'
  )
) {
  throw new Error(
    'Baseline workflow must use the dedicated read-only service account.'
  );
}

const gcpBootstrapSource = fs.readFileSync(gcpBootstrapPath, 'utf8');
const notificationChannelSource = fs.readFileSync(
  notificationChannelPath,
  'utf8'
);
const applyMonitoringSource = fs.readFileSync(applyMonitoringPath, 'utf8');
const captureBaselineSource = fs.readFileSync(captureBaselinePath, 'utf8');

if (
  !applyMonitoringSource.includes('function monitoringFilter(')
  || !applyMonitoringSource.includes('resource.type="')
) {
  throw new Error(
    'Monitoring provisioning must constrain time-series filters by resource.type.'
  );
}

for (const required of [
  "assertion.repository == '",
  "assertion.ref == 'refs/heads/main'",
  'roles/iam.workloadIdentityUser',
  'roles/logging.configWriter',
  'roles/monitoring.dashboardEditor',
  'roles/monitoring.alertPolicyEditor',
  'roles/monitoring.notificationChannelViewer',
  'roles/logging.viewer',
  'roles/serviceusage.serviceUsageConsumer',
  'GCP_COMMUNITY_COST_MONITORING_SERVICE_ACCOUNT',
  'GCP_COMMUNITY_COST_BASELINE_SERVICE_ACCOUNT',
]) {
  if (!gcpBootstrapSource.includes(required)) {
    throw new Error('GCP bootstrap missing security invariant: ' + required);
  }
}

if (
  gcpBootstrapSource.includes('roles/editor')
  || gcpBootstrapSource.includes('roles/owner')
  || gcpBootstrapSource.includes('service-account-key')
) {
  throw new Error(
    'GCP bootstrap must not grant broad roles or create service-account keys.'
  );
}

for (const [name, source] of [
  ['gcp-bootstrap', gcpBootstrapSource],
  ['notification-channel', notificationChannelSource],
  ['monitoring-apply', applyMonitoringSource],
  ['baseline-capture', captureBaselineSource],
]) {
  for (const required of [
    "process.platform === 'win32'",
    "process.env.ComSpec || 'cmd.exe'",
    "'gcloud.cmd'",
  ]) {
    if (!source.includes(required)) {
      throw new Error(
        'Community cost ' + name + ' missing Windows gcloud support: '
        + required
      );
    }
  }
}

if (
  !notificationChannelSource.includes("'beta'")
  || !notificationChannelSource.includes("'monitoring'")
  || !notificationChannelSource.includes("'channels'")
  || !notificationChannelSource.includes("'--type=email'")
  || !notificationChannelSource.includes('email_address=')
) {
  throw new Error(
    'Notification channel bootstrap must use the canonical Monitoring email channel.'
  );
}

if (
  !monitoringWorkflowSource.includes('COMMUNITY_COST_NOTIFICATION_CHANNEL')
  || !monitoringWorkflowSource.includes('community:cost-monitoring:apply')
) {
  throw new Error(
    'Production monitoring workflow must require a notification channel and apply the canonical provisioning script.'
  );
}

if (
  !baselineWorkflowSource.includes('community:cost-baseline:capture')
  || !baselineWorkflowSource.includes('days deve ser inteiro >= 14')
  || baselineWorkflowSource.includes('schedule:')
) {
  throw new Error(
    'Production baseline workflow must be manual, canonical and require at least 14 days.'
  );
}

if (contract.version !== 1 || !Array.isArray(contract.metrics)) {
  throw new Error('Community cost monitoring contract version/metrics invalid.');
}

if (
  contract.baseline?.source !== 'cloud_logging_runtime_events'
  || contract.baseline?.environment !== 'production'
  || contract.baseline?.minimumWindowDays !== 14
) {
  throw new Error(
    'Real baseline contract must require 14 production days from runtime logs.'
  );
}

for (const metric of contract.metrics) {
  if (!metric.valuePath || !metric.metricName || !metric.sampleMetricName) {
    throw new Error(
      'Monitoring metric missing extraction/metric identifiers: ' + metric.key
    );
  }

  if (metric.resourceType !== 'cloud_run_revision') {
    throw new Error(
      'Community cost Monitoring metric must declare cloud_run_revision: '
      + metric.key
    );
  }
  if (!String(metric.filter ?? '').includes(
    'resource.type="cloud_run_revision"'
  )) {
    throw new Error(
      'Community cost runtime log filter must be resource-scoped: '
      + metric.key
    );
  }
  if (
    metric.sampleFilter
    && !metric.sampleFilter.includes('resource.type="cloud_run_revision"')
  ) {
    throw new Error(
      'Community cost sample filter must be resource-scoped: '
      + metric.key
    );
  }

  if (metric.aggregation === 'p95') {
    if (
      metric.aligner !== 'ALIGN_PERCENTILE_95'
      || metric.reducer !== 'REDUCE_PERCENTILE_95'
      || metric.alertStrategy !== 'distribution_percentile_95'
    ) {
      throw new Error('Invalid p95 distribution strategy: ' + metric.key);
    }
  } else if (metric.aggregation === 'mean') {
    if (
      metric.aligner !== 'ALIGN_SUM'
      || metric.reducer !== 'REDUCE_MEAN'
    ) {
      throw new Error('Invalid mean distribution strategy: ' + metric.key);
    }
  } else if (metric.aggregation === 'max') {
    if (
      metric.aligner !== 'ALIGN_SUM'
      || metric.reducer !== 'REDUCE_SUM'
      || metric.alertStrategy !== 'exact_breach_counter'
      || metric.chartPlotType !== 'HEATMAP'
    ) {
      throw new Error('Invalid exact-max monitoring strategy: ' + metric.key);
    }
  } else if (metric.aggregation === 'ratio_per_served') {
    if (
      metric.aligner !== 'ALIGN_SUM'
      || metric.reducer !== 'REDUCE_MEAN'
      || metric.alertStrategy !== 'baseline_only'
      || !metric.denominatorPath
      || !metric.sampleFilter
    ) {
      throw new Error(
        'Invalid served-unit baseline strategy: ' + metric.key
      );
    }
  } else {
    throw new Error('Unsupported cost aggregation: ' + metric.aggregation);
  }
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

function budgetFieldExpression(block, field) {
  const match = block.match(new RegExp(field + ':\\s*([^,\\n]+)'));
  return match?.[1]?.trim() ?? null;
}

function evaluateBudgetNumber(expression) {
  if (!expression) return null;

  const factors = expression.split('*').map((part) => part.trim());
  let value = 1;

  for (const factor of factors) {
    if (factor === 'MIB') {
      value *= 1024 * 1024;
      continue;
    }
    if (factor === 'GIB') {
      value *= 1024 * 1024 * 1024;
      continue;
    }

    const numeric = Number(factor);
    if (!Number.isFinite(numeric)) return null;
    value *= numeric;
  }

  return value;
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

  for (const [field, expected] of [
    ['warningAbove', metric.warningAbove],
    ['criticalAbove', metric.criticalAbove],
    ['minimumSamples', metric.minimumSamples],
  ]) {
    const actual = evaluateBudgetNumber(
      budgetFieldExpression(block, field)
    );
    if (actual !== expected) {
      throw new Error(
        'Monitoring contract drift for '
        + metric.key
        + ': '
        + field
        + ' expected='
        + expected
        + ' actual='
        + String(actual)
      );
    }
  }

  if (!block.includes("aggregation: '" + metric.aggregation + "'")) {
    throw new Error(
      'Monitoring aggregation drift for ' + metric.key
    );
  }
  if (
    evaluateBudgetNumber(
      budgetFieldExpression(block, 'windowMinutes')
    ) * 60 !== metric.windowSeconds
  ) {
    throw new Error(
      'Monitoring window drift for ' + metric.key
    );
  }
  if (!block.includes("measurementSource: 'runtime_log'")) {
    throw new Error(
      'Real monitoring metric must come from runtime_log: ' + metric.key
    );
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

for (const script of [
  applyMonitoringPath,
  captureBaselinePath,
  gcpBootstrapPath,
  notificationChannelPath,
]) {
  const syntax = spawnSync(process.execPath, ['--check', script], {
    cwd: root,
    encoding: 'utf8',
  });
  if (syntax.status !== 0) {
    throw new Error(
      'Operational cost script syntax failed: '
      + script
      + '\n'
      + (syntax.stderr || syntax.stdout || '')
    );
  }
}

const gcpBootstrapDryRun = spawnSync(
  process.execPath,
  [gcpBootstrapPath],
  {
    cwd: root,
    encoding: 'utf8',
  }
);
if (gcpBootstrapDryRun.status !== 0) {
  throw new Error(
    'GCP bootstrap dry-run failed:\n'
    + (gcpBootstrapDryRun.stderr || gcpBootstrapDryRun.stdout || '')
  );
}

const notificationDryRun = spawnSync(
  process.execPath,
  [
    notificationChannelPath,
    '--email=community-cost@example.com',
  ],
  {
    cwd: root,
    encoding: 'utf8',
  }
);
if (notificationDryRun.status !== 0) {
  throw new Error(
    'Notification channel dry-run failed:\n'
    + (notificationDryRun.stderr || notificationDryRun.stdout || '')
  );
}

const dryRun = spawnSync(
  process.execPath,
  [
    applyMonitoringPath,
    '--project=demo-community-cost',
    '--dry-run',
  ],
  {
    cwd: root,
    encoding: 'utf8',
  }
);
if (dryRun.status !== 0) {
  throw new Error(
    'Monitoring provisioning dry-run failed:\n'
    + (dryRun.stderr || dryRun.stdout || '')
  );
}

console.log(
  '[community-cost-operations] OK: monitoring, exact production baseline and commercial calibration gates are aligned.'
);
