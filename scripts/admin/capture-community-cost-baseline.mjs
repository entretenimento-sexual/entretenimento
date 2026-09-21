import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const contract = JSON.parse(
  fs.readFileSync(
    path.join(root, 'ops', 'monitoring', 'community-cost', 'contract.json'),
    'utf8'
  )
);

function parseArgs(argv) {
  const result = {
    project:
      process.env.GOOGLE_CLOUD_PROJECT
      || process.env.GCLOUD_PROJECT
      || '',
    days: Number(contract.baseline?.minimumWindowDays) || 14,
    maxEntriesPerMetric: 200_000,
    output: path.join(
      root,
      '.dev-logs',
      'community-cost-baseline.json'
    ),
  };

  for (const arg of argv) {
    if (arg.startsWith('--project=')) {
      result.project = arg.slice('--project='.length).trim();
    } else if (arg.startsWith('--days=')) {
      result.days = Math.trunc(Number(arg.slice('--days='.length)));
    } else if (arg.startsWith('--max-entries=')) {
      result.maxEntriesPerMetric = Math.trunc(
        Number(arg.slice('--max-entries='.length))
      );
    } else if (arg.startsWith('--output=')) {
      result.output = path.resolve(root, arg.slice('--output='.length));
    } else {
      throw new Error('Argumento desconhecido: ' + arg);
    }
  }

  return result;
}

const args = parseArgs(process.argv.slice(2));

if (!args.project) {
  throw new Error(
    'Informe --project=<id> ou GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT.'
  );
}
if (args.project !== contract.baseline.productionProjectId) {
  throw new Error(
    'Baseline comercial só pode ser capturado do projeto canônico de produção: '
    + contract.baseline.productionProjectId
  );
}
if (
  !Number.isInteger(args.days)
  || args.days < Number(contract.baseline.minimumWindowDays)
) {
  throw new Error(
    'Baseline real exige pelo menos '
    + contract.baseline.minimumWindowDays
    + ' dias.'
  );
}
if (
  !Number.isInteger(args.maxEntriesPerMetric)
  || args.maxEntriesPerMetric < 1_000
) {
  throw new Error('--max-entries deve ser inteiro >= 1000.');
}

const generatedAt = Date.now();
const windowEndedAt = generatedAt;
const windowStartedAt =
  windowEndedAt - args.days * 24 * 60 * 60 * 1_000;
const startIso = new Date(windowStartedAt).toISOString();
const endIso = new Date(windowEndedAt).toISOString();

function runGcloud(commandArgs) {
  const executable = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'gcloud';
  const executableArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'gcloud.cmd', ...commandArgs]
    : commandArgs;

  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      'Falha executando gcloud '
      + commandArgs.join(' ')
      + (result.stderr ? '\n' + result.stderr : '')
    );
  }

  return result.stdout || '';
}

function getPath(source, dottedPath) {
  const parts = String(dottedPath ?? '').split('.').filter(Boolean);
  let current = source;

  for (const part of parts) {
    if (
      !current
      || typeof current !== 'object'
      || Array.isArray(current)
      || !(part in current)
    ) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

function observationDay(timestamp) {
  const value = Date.parse(String(timestamp ?? ''));
  if (!Number.isFinite(value)) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const find = (type) =>
    parts.find((item) => item.type === type)?.value ?? '';

  return find('year') + '-' + find('month') + '-' + find('day');
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];

  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) return sorted[lower];

  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function aggregate(metric, values, denominatorCount) {
  if (values.length === 0) return null;

  if (metric.aggregation === 'mean') {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  if (metric.aggregation === 'max') {
    return values.reduce(
      (currentMax, value) => Math.max(currentMax, value),
      Number.NEGATIVE_INFINITY
    );
  }
  if (metric.aggregation === 'p95') {
    return percentile(values, 0.95);
  }
  if (metric.aggregation === 'ratio_per_served') {
    if (denominatorCount <= 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / denominatorCount;
  }

  throw new Error(
    'Agregação de baseline não suportada: ' + metric.aggregation
  );
}

function budgetStatus(metric, value) {
  if (!metric.budgeted || value === null) return 'baseline_only';
  if (value > metric.criticalAbove) return 'critical';
  if (value > metric.warningAbove) return 'warning';
  return 'within';
}

function readMetricEntries(metric) {
  const filter = [
    'timestamp >= "' + startIso + '"',
    'timestamp <= "' + endIso + '"',
    '(' + metric.filter + ')',
  ].join(' AND ');

  const stdout = runGcloud([
    'logging',
    'read',
    filter,
    '--project=' + args.project,
    '--order=asc',
    '--limit=' + args.maxEntriesPerMetric,
    '--format=json',
  ]);
  const entries = JSON.parse(stdout || '[]');

  if (!Array.isArray(entries)) {
    throw new Error('Resposta inesperada do Cloud Logging para ' + metric.key);
  }
  if (entries.length >= args.maxEntriesPerMetric) {
    throw new Error(
      'Captura de '
      + metric.key
      + ' atingiu --max-entries='
      + args.maxEntriesPerMetric
      + '. Aumente o limite para não produzir baseline truncado.'
    );
  }

  return entries;
}

const metrics = {};

for (const metric of contract.metrics) {
  const entries = readMetricEntries(metric);
  const values = [];
  const valueObservedDays = new Set();
  const denominatorObservedDays = new Set();
  let denominatorCount = 0;
  let invalidValueCount = 0;

  for (const entry of entries) {
    const rawValue = getPath(entry, metric.valuePath);
    const value = Number(rawValue);

    const validValue = Number.isFinite(value) && value >= 0;

    if (validValue) {
      values.push(value);
      const day = observationDay(entry.timestamp);
      if (day) valueObservedDays.add(day);
    } else {
      invalidValueCount += 1;
    }

    if (
      validValue
      && metric.denominatorPath
      && getPath(entry, metric.denominatorPath) === true
    ) {
      denominatorCount += 1;
      const day = observationDay(entry.timestamp);
      if (day) denominatorObservedDays.add(day);
    }
  }

  if (invalidValueCount > 0) {
    throw new Error(
      'Baseline recusado para '
      + metric.key
      + ': '
      + invalidValueCount
      + ' eventos possuem valor operacional inválido.'
    );
  }

  const ratioMetric = metric.aggregation === 'ratio_per_served';
  const sampleCount = ratioMetric ? denominatorCount : values.length;
  const observedDays = ratioMetric
    ? denominatorObservedDays.size
    : valueObservedDays.size;
  const baselineValueRaw = aggregate(
    metric,
    values,
    denominatorCount
  );
  const baselineValue =
    baselineValueRaw === null ? null : round(baselineValueRaw);
  const minValue = values.length === 0
    ? null
    : round(values.reduce(
      (currentMin, value) => Math.min(currentMin, value),
      Number.POSITIVE_INFINITY
    ));
  const maxValue = values.length === 0
    ? null
    : round(values.reduce(
      (currentMax, value) => Math.max(currentMax, value),
      Number.NEGATIVE_INFINITY
    ));

  metrics[metric.key] = {
    sampleCount,
    observedDays,
    aggregation: metric.aggregation,
    baselineValue,
    minValue,
    maxValue,
    ...(ratioMetric
      ? {
          requestCount: values.length,
          servedPlacementCount: denominatorCount,
          totalProxyUnits: round(
            values.reduce((sum, value) => sum + value, 0)
          ),
        }
      : {}),
    status: budgetStatus(metric, baselineValue),
    unit: metric.unit,
    minimumSamples: metric.minimumSamples,
    minimumObservedDays: metric.minimumObservedDays,
  };

  console.log(
    '[community-cost-baseline] '
    + metric.key
    + ': samples='
    + sampleCount
    + ', days='
    + observedDays
    + ', value='
    + String(baselineValue)
  );
}

const payload = {
  schemaVersion: Number(contract.baseline.schemaVersion),
  source: contract.baseline.source,
  environment: 'production',
  projectId: args.project,
  windowStartedAt,
  windowEndedAt,
  generatedAt,
  windowStartedAtIso: startIso,
  windowEndedAtIso: endIso,
  captureMaxEntriesPerMetric: args.maxEntriesPerMetric,
  metrics,
};

fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(
  args.output,
  JSON.stringify(payload, null, 2) + '\n',
  'utf8'
);

console.log('[community-cost-baseline] salvo em ' + args.output);
