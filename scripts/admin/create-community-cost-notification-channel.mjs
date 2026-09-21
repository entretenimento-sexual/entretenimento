import { spawnSync } from 'node:child_process';

const CANONICAL_PROJECT = 'entretenimento-sexual';

function parseArgs(argv) {
  const result = {
    project: CANONICAL_PROJECT,
    email: '',
    displayName: 'Community Cost Operations',
    apply: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--project=')) {
      result.project = arg.slice('--project='.length).trim();
    } else if (arg.startsWith('--email=')) {
      result.email = arg.slice('--email='.length).trim();
    } else if (arg.startsWith('--display-name=')) {
      result.displayName = arg.slice('--display-name='.length).trim();
    } else if (arg === '--apply') {
      result.apply = true;
    } else {
      throw new Error('Argumento desconhecido: ' + arg);
    }
  }

  return result;
}

const args = parseArgs(process.argv.slice(2));

if (args.project !== CANONICAL_PROJECT) {
  throw new Error(
    'Notification channel permitido apenas no projeto canônico: '
    + CANONICAL_PROJECT
  );
}
if (!args.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
  throw new Error('Informe --email=<endereco-valido>.');
}

function run(commandArgs, options = {}) {
  const printable = ['gcloud', ...commandArgs].join(' ');

  if (!args.apply && !options.forceRead) {
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

console.log(
  args.apply
    ? '[community-cost-notification-channel] APPLY'
    : '[community-cost-notification-channel] DRY-RUN'
);

let existing = '';
if (args.apply) {
  existing = run(
    [
      'beta',
      'monitoring',
      'channels',
      'list',
      '--project=' + args.project,
      '--filter=type="email"',
      '--format=value(name,labels.email_address)',
    ],
    { capture: true }
  ).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.endsWith('\t' + args.email))
    ?.split('\t')[0] ?? '';
}

if (existing) {
  console.log('[ok] canal existente: ' + existing);
  console.log('COMMUNITY_COST_NOTIFICATION_CHANNEL=' + existing);
  process.exit(0);
}

run([
  'beta',
  'monitoring',
  'channels',
  'create',
  '--project=' + args.project,
  '--display-name=' + args.displayName,
  '--description=Operational cost alerts for Community',
  '--type=email',
  '--channel-labels=email_address=' + args.email,
  '--user-labels=domain=community,signal=cost',
]);

if (!args.apply) {
  console.log(
    'Após --apply, copie o resource name retornado para '
    + 'COMMUNITY_COST_NOTIFICATION_CHANNEL.'
  );
  process.exit(0);
}

const created = run(
  [
    'beta',
    'monitoring',
    'channels',
    'list',
    '--project=' + args.project,
    '--filter=type="email"',
    '--format=value(name,labels.email_address)',
  ],
  { capture: true }
).stdout
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .find((line) => line.endsWith('\t' + args.email))
  ?.split('\t')[0] ?? '';

if (!created) {
  throw new Error(
    'Canal criado, mas o resource name não pôde ser resolvido.'
  );
}

console.log('COMMUNITY_COST_NOTIFICATION_CHANNEL=' + created);
