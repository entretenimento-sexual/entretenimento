import { spawnSync } from 'node:child_process';

const CANONICAL_PROJECT = 'entretenimento-sexual';
const CANONICAL_REPOSITORY = 'entretenimento-sexual/entretenimento';
const DEFAULT_POOL = 'github-community-cost';
const DEFAULT_PROVIDER = 'community-cost';
const DEFAULT_MONITORING_SERVICE_ACCOUNT = 'community-cost-monitoring';
const DEFAULT_BASELINE_SERVICE_ACCOUNT = 'community-cost-baseline';

const MONITORING_ROLES = Object.freeze([
  'roles/logging.configWriter',
  'roles/monitoring.dashboardEditor',
  'roles/monitoring.alertPolicyEditor',
  'roles/monitoring.notificationChannelViewer',
  'roles/serviceusage.serviceUsageConsumer',
]);

const BASELINE_ROLES = Object.freeze([
  'roles/logging.viewer',
  'roles/serviceusage.serviceUsageConsumer',
]);

function parseArgs(argv) {
  const result = {
    project: CANONICAL_PROJECT,
    repository: CANONICAL_REPOSITORY,
    pool: DEFAULT_POOL,
    provider: DEFAULT_PROVIDER,
    monitoringServiceAccountId: DEFAULT_MONITORING_SERVICE_ACCOUNT,
    baselineServiceAccountId: DEFAULT_BASELINE_SERVICE_ACCOUNT,
    apply: false,
    configureGithubVariables: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--project=')) {
      result.project = arg.slice('--project='.length).trim();
    } else if (arg.startsWith('--repository=')) {
      result.repository = arg.slice('--repository='.length).trim();
    } else if (arg.startsWith('--pool=')) {
      result.pool = arg.slice('--pool='.length).trim();
    } else if (arg.startsWith('--provider=')) {
      result.provider = arg.slice('--provider='.length).trim();
    } else if (arg.startsWith('--monitoring-service-account-id=')) {
      result.monitoringServiceAccountId = arg
        .slice('--monitoring-service-account-id='.length)
        .trim();
    } else if (arg.startsWith('--baseline-service-account-id=')) {
      result.baselineServiceAccountId = arg
        .slice('--baseline-service-account-id='.length)
        .trim();
    } else if (arg === '--apply') {
      result.apply = true;
    } else if (arg === '--configure-github-variables') {
      result.configureGithubVariables = true;
    } else {
      throw new Error('Argumento desconhecido: ' + arg);
    }
  }

  return result;
}

const args = parseArgs(process.argv.slice(2));

if (args.project !== CANONICAL_PROJECT) {
  throw new Error(
    'Bootstrap permitido apenas no projeto canônico: ' + CANONICAL_PROJECT
  );
}
if (args.repository !== CANONICAL_REPOSITORY) {
  throw new Error(
    'Bootstrap permitido apenas no repositório canônico: '
    + CANONICAL_REPOSITORY
  );
}
if (args.configureGithubVariables && !args.apply) {
  throw new Error(
    '--configure-github-variables exige --apply para evitar configuração parcial.'
  );
}

function run(command, commandArgs, options = {}) {
  const printable = [command, ...commandArgs].join(' ');

  if (!args.apply && !options.forceRead) {
    console.log('[dry-run] ' + printable);
    return { status: 0, stdout: '' };
  }

  const executable = command === 'gcloud' && process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : command;
  const executableArgs = command === 'gcloud' && process.platform === 'win32'
    ? ['/d', '/s', '/c', 'gcloud.cmd', ...commandArgs]
    : commandArgs;

  const result = spawnSync(executable, executableArgs, {
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

function gcloudExists(commandArgs) {
  if (!args.apply) return false;
  return run('gcloud', commandArgs, {
    capture: true,
    allowFailure: true,
  }).status === 0;
}

function ensureServiceAccount(serviceAccountId, displayName) {
  const email = serviceAccountId + '@' + args.project + '.iam.gserviceaccount.com';

  if (
    gcloudExists([
      'iam',
      'service-accounts',
      'describe',
      email,
      '--project=' + args.project,
      '--format=value(email)',
    ])
  ) {
    console.log('[ok] service account existente: ' + email);
    return email;
  }

  run('gcloud', [
    'iam',
    'service-accounts',
    'create',
    serviceAccountId,
    '--project=' + args.project,
    '--display-name=' + displayName,
  ]);
  return email;
}

function ensureProjectRole(serviceAccountEmail, role) {
  run('gcloud', [
    'projects',
    'add-iam-policy-binding',
    args.project,
    '--member=serviceAccount:' + serviceAccountEmail,
    '--role=' + role,
    '--condition=None',
    '--quiet',
  ]);
}

function ensureWorkloadIdentityBinding(
  serviceAccountEmail,
  poolResourceName
) {
  const principal =
    'principalSet://iam.googleapis.com/'
    + poolResourceName
    + '/attribute.repository/'
    + args.repository;

  run('gcloud', [
    'iam',
    'service-accounts',
    'add-iam-policy-binding',
    serviceAccountEmail,
    '--project=' + args.project,
    '--member=' + principal,
    '--role=roles/iam.workloadIdentityUser',
    '--quiet',
  ]);
}

console.log(
  args.apply
    ? '[community-cost-gcp-bootstrap] APPLY'
    : '[community-cost-gcp-bootstrap] DRY-RUN'
);

run('gcloud', [
  'services',
  'enable',
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
  'sts.googleapis.com',
  'logging.googleapis.com',
  'monitoring.googleapis.com',
  'serviceusage.googleapis.com',
  '--project=' + args.project,
]);

const monitoringServiceAccount = ensureServiceAccount(
  args.monitoringServiceAccountId,
  'Community Cost Monitoring'
);
const baselineServiceAccount = ensureServiceAccount(
  args.baselineServiceAccountId,
  'Community Cost Baseline Reader'
);

if (
  !gcloudExists([
    'iam',
    'workload-identity-pools',
    'describe',
    args.pool,
    '--project=' + args.project,
    '--location=global',
    '--format=value(name)',
  ])
) {
  run('gcloud', [
    'iam',
    'workload-identity-pools',
    'create',
    args.pool,
    '--project=' + args.project,
    '--location=global',
    '--display-name=GitHub Community Cost',
  ]);
}

const providerArgs = [
  args.provider,
  '--project=' + args.project,
  '--location=global',
  '--workload-identity-pool=' + args.pool,
  '--display-name=Community Cost GitHub',
  '--issuer-uri=https://token.actions.githubusercontent.com',
  '--attribute-mapping=google.subject=assertion.sub,'
    + 'attribute.repository=assertion.repository,'
    + 'attribute.repository_owner=assertion.repository_owner,'
    + 'attribute.ref=assertion.ref',
  "--attribute-condition=assertion.repository == '"
    + args.repository
    + "' && assertion.ref == 'refs/heads/main'",
];

if (
  gcloudExists([
    'iam',
    'workload-identity-pools',
    'providers',
    'describe',
    args.provider,
    '--project=' + args.project,
    '--location=global',
    '--workload-identity-pool=' + args.pool,
    '--format=value(name)',
  ])
) {
  run('gcloud', [
    'iam',
    'workload-identity-pools',
    'providers',
    'update-oidc',
    ...providerArgs,
  ]);
} else {
  run('gcloud', [
    'iam',
    'workload-identity-pools',
    'providers',
    'create-oidc',
    ...providerArgs,
  ]);
}

let poolResourceName =
  'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/'
  + args.pool;
let providerResourceName =
  poolResourceName + '/providers/' + args.provider;

if (args.apply) {
  poolResourceName = run(
    'gcloud',
    [
      'iam',
      'workload-identity-pools',
      'describe',
      args.pool,
      '--project=' + args.project,
      '--location=global',
      '--format=value(name)',
    ],
    { capture: true }
  ).stdout.trim();

  providerResourceName = run(
    'gcloud',
    [
      'iam',
      'workload-identity-pools',
      'providers',
      'describe',
      args.provider,
      '--project=' + args.project,
      '--location=global',
      '--workload-identity-pool=' + args.pool,
      '--format=value(name)',
    ],
    { capture: true }
  ).stdout.trim();
}

ensureWorkloadIdentityBinding(
  monitoringServiceAccount,
  poolResourceName
);
ensureWorkloadIdentityBinding(
  baselineServiceAccount,
  poolResourceName
);

for (const role of MONITORING_ROLES) {
  ensureProjectRole(monitoringServiceAccount, role);
}
for (const role of BASELINE_ROLES) {
  ensureProjectRole(baselineServiceAccount, role);
}

const githubVariables = Object.freeze({
  GCP_COMMUNITY_COST_WORKLOAD_IDENTITY_PROVIDER: providerResourceName,
  GCP_COMMUNITY_COST_MONITORING_SERVICE_ACCOUNT: monitoringServiceAccount,
  GCP_COMMUNITY_COST_BASELINE_SERVICE_ACCOUNT: baselineServiceAccount,
});

if (args.configureGithubVariables) {
  for (const [name, value] of Object.entries(githubVariables)) {
    run('gh', [
      'variable',
      'set',
      name,
      '--repo',
      args.repository,
      '--body',
      value,
    ]);
  }
}

console.log('\nGitHub repository variables:');
for (const [name, value] of Object.entries(githubVariables)) {
  console.log(name + '=' + value);
}

console.log(
  '\nProvider condition: repository='
  + args.repository
  + ', ref=refs/heads/main'
);
console.log(
  'Monitoring SA roles: ' + MONITORING_ROLES.join(', ')
);
console.log(
  'Baseline SA roles: ' + BASELINE_ROLES.join(', ')
);
