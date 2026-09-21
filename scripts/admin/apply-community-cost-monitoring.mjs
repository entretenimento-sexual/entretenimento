import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const contractPath = path.join(
  root,
  'ops',
  'monitoring',
  'community-cost',
  'contract.json'
);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

function parseArgs(argv) {
  const result = {
    project:
      process.env.GOOGLE_CLOUD_PROJECT
      || process.env.GCLOUD_PROJECT
      || '',
    notificationChannels: String(
      process.env.COMMUNITY_COST_NOTIFICATION_CHANNELS || ''
    ).split(',').map((value) => value.trim()).filter(Boolean),
    allowNoNotificationChannels: false,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--project=')) {
      result.project = arg.slice('--project='.length).trim();
    } else if (arg.startsWith('--notification-channel=')) {
      const channel = arg.slice('--notification-channel='.length).trim();
      if (channel) result.notificationChannels.push(channel);
    } else if (arg === '--allow-no-notification-channels') {
      result.allowNoNotificationChannels = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else {
      throw new Error('Argumento desconhecido: ' + arg);
    }
  }

  result.notificationChannels = [...new Set(result.notificationChannels)];
  return result;
}

const args = parseArgs(process.argv.slice(2));

if (!args.project) {
  throw new Error(
    'Informe --project=<id> ou GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT.'
  );
}

if (
  !args.dryRun
  && args.notificationChannels.length === 0
  && !args.allowNoNotificationChannels
) {
  throw new Error(
    'Alertas operacionais exigem notification channel. '
    + 'Use --notification-channel=<resource>, '
    + 'COMMUNITY_COST_NOTIFICATION_CHANNELS ou, conscientemente, '
    + '--allow-no-notification-channels.'
  );
}

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'community-cost-monitoring-')
);

function runGcloud(commandArgs, options = {}) {
  const printable = ['gcloud', ...commandArgs].join(' ');

  if (args.dryRun) {
    console.log('[dry-run] ' + printable);
    return { status: 0, stdout: '' };
  }

  const executable = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'gcloud';
  const executableArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'gcloud.cmd', ...commandArgs]
    : commandArgs;

  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) throw result.error;

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      'Falha executando: '
      + printable
      + (result.stderr ? '\n' + result.stderr : '')
    );
  }

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function writeJson(name, value) {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return file;
}

function metricType(metricName) {
  return 'logging.googleapis.com/user/' + metricName;
}

function monitoringFilter(metricName, resourceType) {
  return (
    'metric.type="' + metricType(metricName) + '"'
    + ' AND resource.type="' + resourceType + '"'
  );
}

function buildDistributionMetric(metric) {
  return {
    name: metric.metricName,
    description: metric.description,
    filter: metric.filter,
    valueExtractor: metric.valueExtractor,
    bucketOptions: metric.bucketOptions,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'DISTRIBUTION',
      unit: metric.unit,
      displayName: metric.key,
    },
  };
}

function buildCounterMetric(name, description, filter) {
  return {
    name,
    description,
    filter,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      displayName: name,
    },
  };
}

function buildSampleMetric(metric) {
  return buildCounterMetric(
    metric.sampleMetricName,
    'Amostras para gate de alerta/baseline de ' + metric.key + '.',
    metric.sampleFilter ?? metric.filter
  );
}

function breachMetricName(metric, level) {
  return metric.metricName + '_' + level + '_breaches';
}

function buildBreachMetric(metric, level) {
  const threshold =
    level === 'warning' ? metric.warningAbove : metric.criticalAbove;
  return buildCounterMetric(
    breachMetricName(metric, level),
    'Eventos acima do threshold ' + level + ' de ' + metric.key + '.',
    metric.filter
      + ' AND jsonPayload.operationalCostBudget.value > '
      + threshold
  );
}

function upsertLogMetric(name, config) {
  const file = writeJson(name + '.json', config);
  const existing = runGcloud(
    [
      'logging',
      'metrics',
      'describe',
      name,
      '--project=' + args.project,
      '--format=value(name)',
    ],
    { capture: true, allowFailure: true }
  );

  const verb = existing.status === 0 ? 'update' : 'create';

  runGcloud([
    'logging',
    'metrics',
    verb,
    name,
    '--project=' + args.project,
    '--config-from-file=' + file,
    '--quiet',
  ]);
}

function dashboardThresholds(metric) {
  if (!metric.budgeted || metric.chartPlotType === 'HEATMAP') return [];

  return [
    {
      label: 'warning',
      value: metric.warningAbove,
      targetAxis: 'Y1',
    },
    {
      label: 'critical',
      value: metric.criticalAbove,
      targetAxis: 'Y1',
    },
  ];
}

function buildDashboardWidget(metric) {
  return {
    title:
      metric.key
      + ' ['
      + String(metric.dashboardAggregation ?? metric.aggregation)
        .toUpperCase()
      + ']',
    xyChart: {
      dataSets: [
        {
          timeSeriesQuery: {
            timeSeriesFilter: {
              filter: monitoringFilter(
                metric.metricName,
                metric.resourceType
              ),
              aggregation: {
                alignmentPeriod: metric.windowSeconds + 's',
                perSeriesAligner: metric.aligner,
                crossSeriesReducer: metric.reducer,
                groupByFields: [],
              },
            },
            unitOverride: metric.unit,
          },
          plotType: metric.chartPlotType,
          targetAxis: 'Y1',
          minAlignmentPeriod: metric.windowSeconds + 's',
        },
      ],
      thresholds: dashboardThresholds(metric),
      yAxis: {
        label: metric.unit,
        scale: 'LINEAR',
      },
      chartOptions: {
        mode: 'COLOR',
      },
    },
  };
}

function buildDashboard() {
  const widgets = [
    {
      text: {
        content:
          'Baseline real de custo de Comunidades. '
          + 'Os budgets são proxies operacionais, não preços. '
          + 'Boost permanece baseline-only até existir evidência suficiente '
          + 'para calibrar custo financeiro.',
        format: 'MARKDOWN',
      },
    },
    ...contract.metrics.map(buildDashboardWidget),
  ];

  return {
    displayName: contract.dashboardDisplayName,
    labels: {
      domain: 'communities',
      purpose: 'operational-cost',
    },
    gridLayout: {
      columns: 2,
      widgets,
    },
  };
}

function upsertDashboard() {
  const list = runGcloud(
    [
      'monitoring',
      'dashboards',
      'list',
      '--project=' + args.project,
      '--filter=displayName="' + contract.dashboardDisplayName + '"',
      '--format=json',
    ],
    { capture: true }
  );
  const existing = args.dryRun ? [] : JSON.parse(list.stdout || '[]');
  const dashboard = buildDashboard();

  if (existing.length > 1) {
    throw new Error(
      'Mais de um dashboard encontrado com displayName '
      + contract.dashboardDisplayName
    );
  }

  if (existing.length === 1) {
    dashboard.name = existing[0].name;
    dashboard.etag = existing[0].etag;
    const file = writeJson('dashboard.json', dashboard);
    runGcloud([
      'monitoring',
      'dashboards',
      'update',
      existing[0].name,
      '--project=' + args.project,
      '--config-from-file=' + file,
      '--quiet',
    ]);
    return;
  }

  const file = writeJson('dashboard.json', dashboard);
  runGcloud([
    'monitoring',
    'dashboards',
    'create',
    '--project=' + args.project,
    '--config-from-file=' + file,
    '--quiet',
  ]);
}

function distributionValueCondition(metric, level) {
  const threshold =
    level === 'warning' ? metric.warningAbove : metric.criticalAbove;

  return {
    displayName: 'valor agregado acima do budget',
    conditionThreshold: {
      filter: monitoringFilter(metric.metricName, metric.resourceType),
      aggregations: [
        {
          alignmentPeriod: metric.windowSeconds + 's',
          perSeriesAligner: metric.aligner,
          crossSeriesReducer: metric.reducer,
          groupByFields: [],
        },
      ],
      comparison: 'COMPARISON_GT',
      thresholdValue: threshold,
      duration:
        level === 'warning'
          ? (metric.windowSeconds * 2) + 's'
          : '0s',
      trigger: { count: 1 },
    },
  };
}

function sampleCountCondition(metric) {
  return {
    displayName: 'amostragem mínima',
    conditionThreshold: {
      filter: monitoringFilter(
        metric.sampleMetricName,
        metric.resourceType
      ),
      aggregations: [
        {
          alignmentPeriod: metric.windowSeconds + 's',
          perSeriesAligner: 'ALIGN_SUM',
          crossSeriesReducer: 'REDUCE_SUM',
          groupByFields: [],
        },
      ],
      comparison: 'COMPARISON_GT',
      thresholdValue: Math.max(0, metric.minimumSamples - 1),
      duration: '0s',
      trigger: { count: 1 },
    },
  };
}

function exactBreachCondition(metric, level) {
  return {
    displayName: 'evento acima do budget',
    conditionThreshold: {
      filter: monitoringFilter(
        breachMetricName(metric, level),
        metric.resourceType
      ),
      aggregations: [
        {
          alignmentPeriod: metric.windowSeconds + 's',
          perSeriesAligner: 'ALIGN_SUM',
          crossSeriesReducer: 'REDUCE_SUM',
          groupByFields: [],
        },
      ],
      comparison: 'COMPARISON_GT',
      thresholdValue: 0,
      duration: '0s',
      trigger: { count: 1 },
    },
  };
}

function buildAlertPolicy(metric, level) {
  const displayName =
    '[Community Cost] '
    + level.toUpperCase()
    + ' '
    + metric.key;

  const exactMax = metric.alertStrategy === 'exact_breach_counter';
  const conditions = exactMax
    ? [exactBreachCondition(metric, level)]
    : [
        distributionValueCondition(metric, level),
        sampleCountCondition(metric),
      ];

  return {
    displayName,
    documentation: {
      content:
        'Budget operacional de Comunidades. Métrica: '
        + metric.key
        + '. Nível: '
        + level
        + '. Estratégia: '
        + metric.alertStrategy
        + '. Validar volume, baseline e billing real antes de otimizar.',
      mimeType: 'text/markdown',
    },
    userLabels: {
      domain: 'communities',
      cost_level: level,
    },
    conditions,
    combiner: conditions.length > 1 ? 'AND' : 'OR',
    enabled: true,
    notificationChannels: args.notificationChannels,
  };
}

function upsertAlertPolicy(metric, level) {
  const policy = buildAlertPolicy(metric, level);
  const existingList = runGcloud(
    [
      'monitoring',
      'policies',
      'list',
      '--project=' + args.project,
      '--filter=displayName="' + policy.displayName + '"',
      '--format=json',
    ],
    { capture: true }
  );
  const existing = args.dryRun
    ? []
    : JSON.parse(existingList.stdout || '[]');

  if (existing.length > 1) {
    throw new Error(
      'Mais de uma alert policy encontrada: ' + policy.displayName
    );
  }

  const file = writeJson(
    metric.metricName + '-' + level + '-alert.json',
    policy
  );

  if (existing.length === 1) {
    runGcloud([
      'monitoring',
      'policies',
      'update',
      existing[0].name,
      '--project=' + args.project,
      '--policy-from-file=' + file,
      '--quiet',
    ]);
    return;
  }

  runGcloud([
    'monitoring',
    'policies',
    'create',
    '--project=' + args.project,
    '--policy-from-file=' + file,
    '--quiet',
  ]);
}

for (const metric of contract.metrics) {
  upsertLogMetric(metric.metricName, buildDistributionMetric(metric));
  upsertLogMetric(metric.sampleMetricName, buildSampleMetric(metric));

  if (
    metric.budgeted === true
    && metric.alertStrategy === 'exact_breach_counter'
  ) {
    upsertLogMetric(
      breachMetricName(metric, 'warning'),
      buildBreachMetric(metric, 'warning')
    );
    upsertLogMetric(
      breachMetricName(metric, 'critical'),
      buildBreachMetric(metric, 'critical')
    );
  }
}

upsertDashboard();

for (const metric of contract.metrics.filter((item) => item.budgeted === true)) {
  upsertAlertPolicy(metric, 'warning');
  upsertAlertPolicy(metric, 'critical');
}

console.log(
  '[community-cost-monitoring] concluído para projeto ' + args.project
);
