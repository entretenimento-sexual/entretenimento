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
    project: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
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

  const result = spawnSync('gcloud', commandArgs, {
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

function buildSampleMetric(metric) {
  return {
    name: metric.sampleMetricName,
    description: 'Amostras para gate de alerta/baseline de ' + metric.key + '.',
    filter: metric.filter,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      displayName: metric.key + ' samples',
    },
  };
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

function buildDashboard() {
  const widgets = [
    {
      text: {
        content:
          'Baseline real de custo de Comunidades. Métricas de Boost são '
          + 'baseline-only até existir evidência suficiente para calibrar custo.',
        format: 'MARKDOWN',
      },
    },
  ];

  for (const metric of contract.metrics) {
    const thresholds = metric.budgeted
      ? [
          {
            value: metric.warningAbove,
            color: 'YELLOW',
            direction: 'ABOVE',
            targetAxis: 'Y1',
          },
          {
            value: metric.criticalAbove,
            color: 'RED',
            direction: 'ABOVE',
            targetAxis: 'Y1',
          },
        ]
      : [];

    widgets.push({
      title: metric.key,
      xyChart: {
        dataSets: [
          {
            timeSeriesQuery: {
              timeSeriesFilter: {
                filter: 'metric.type="' + metricType(metric.metricName) + '"',
                aggregation: {
                  alignmentPeriod: metric.windowSeconds + 's',
                  perSeriesAligner: metric.aligner,
                  crossSeriesReducer: metric.reducer,
                  groupByFields: [],
                },
              },
              unitOverride: metric.unit,
            },
            plotType: 'LINE',
            targetAxis: 'Y1',
            minAlignmentPeriod: metric.windowSeconds + 's',
          },
        ],
        thresholds,
        yAxis: {
          label: metric.unit,
          scale: 'LINEAR',
        },
        chartOptions: {
          mode: 'COLOR',
        },
      },
    });
  }

  return {
    displayName: contract.dashboardDisplayName,
    labels: {
      domain: 'communities',
      purpose: 'operational-cost',
    },
    gridLayout: {
      columns: '2',
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
  const existing = args.dryRun
    ? []
    : JSON.parse(list.stdout || '[]');
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

function buildAlertPolicy(metric, level) {
  const threshold =
    level === 'warning' ? metric.warningAbove : metric.criticalAbove;
  const displayName =
    '[Community Cost] '
    + level.toUpperCase()
    + ' '
    + metric.key;
  const valueDuration =
    level === 'warning' ? metric.windowSeconds + 's' : '0s';

  return {
    displayName,
    documentation: {
      content:
        'Budget operacional de Comunidades. Métrica: '
        + metric.key
        + '. Nível: '
        + level
        + '. Validar volume, baseline e billing real antes de otimizar.',
      mimeType: 'text/markdown',
    },
    userLabels: {
      domain: 'communities',
      cost_level: level,
    },
    conditions: [
      {
        displayName: 'valor acima do budget',
        conditionThreshold: {
          filter: 'metric.type="' + metricType(metric.metricName) + '"',
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
          duration: valueDuration,
          trigger: { count: 1 },
        },
      },
      {
        displayName: 'amostragem mínima',
        conditionThreshold: {
          filter: 'metric.type="' + metricType(metric.sampleMetricName) + '"',
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
      },
    ],
    combiner: 'AND',
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
}

upsertDashboard();

for (const metric of contract.metrics.filter((item) => item.budgeted === true)) {
  upsertAlertPolicy(metric, 'warning');
  upsertAlertPolicy(metric, 'critical');
}

console.log(
  '[community-cost-monitoring] concluído para projeto ' + args.project
);
