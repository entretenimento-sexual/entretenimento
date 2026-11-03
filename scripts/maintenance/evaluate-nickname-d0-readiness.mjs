// Offline D0 candidate checker; never creates an actual D0 certificate.
import { readFileSync } from 'node:fs';
import { assessNicknameD0Readiness } from './nickname-d0-readiness.policy.mjs';

function readArg(name) {
  const pos = process.argv.indexOf(name);
  return pos >= 0 ? process.argv[pos + 1] : null;
}
function load(name) {
  const file = readArg(name);
  if (!file) return null;
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(name + ': relatório agregado JSON inválido');
  }
  return value;
}
const outcome = assessNicknameD0Readiness({
  preflight: load('--preflight'),
  controls: load('--controls'),
});
console.log(JSON.stringify(outcome, null, 2));
if (outcome.status !== 'D0_CANDIDATE') process.exitCode = 2;
