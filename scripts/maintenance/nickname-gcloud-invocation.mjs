// A gcloud.cmd script cannot be launched directly by Node on Windows.
// PowerShell passes each literal argument through to the CLI, avoiding CMD
// shell metacharacters in Cloud Logging filters. No Firebase mutations here.
import { spawnSync } from 'node:child_process';

const SAFE_COMMAND_ARGUMENT = /^[^\u0000-\u001f\u007f]+$/u;

function powerShellLiteral(argument) {
  if (typeof argument !== 'string' || !SAFE_COMMAND_ARGUMENT.test(argument)) {
    throw new TypeError('Invalid Cloud CLI argument.');
  }
  // The downstream gcloud.cmd batch launcher forwards arguments to Python.
  // Backslash-escape nested quotes so the batch-to-Python boundary retains
  // Cloud Logging string literals instead of swallowing their quote marks.
  return "'" + argument.replaceAll('"', '\\\"').replaceAll("'", "''") + "'";
}

export function buildSafeGcloudPowerShellCommand(args) {
  if (!Array.isArray(args) || args.length < 1) {
    throw new TypeError('Missing Cloud CLI arguments.');
  }
  // Single-quote all arguments and never concatenate unquoted user content.
  return '& gcloud ' + args.map(powerShellLiteral).join(' ') +
    '; exit $LASTEXITCODE';
}

export function spawnReadOnlyGcloud(args, {
  platform = process.platform, env = process.env,
} = {}) {
  const gcloudArgs = ['--quiet', ...args];
  const options = {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    shell: false,
    env,
  };
  if (platform === 'win32') {
    return spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      buildSafeGcloudPowerShellCommand(gcloudArgs),
    ], options);
  }
  return spawnSync('gcloud', gcloudArgs, options);
}
