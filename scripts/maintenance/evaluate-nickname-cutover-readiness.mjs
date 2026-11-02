// Offline only. Expects sanitized JSON reports and human release attestation.
// Never writes Rules, performs data migration, or initiates deployment.
import { readFileSync } from 'node:fs';
import { evaluateNicknameCutoverDecision } from './nickname-cutover-decision.policy.mjs';

function load(file) {
  if (!file) return null;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || Array.isArray(data) || typeof data !== 'object') {
    throw new Error('O relatório precisa ser um objeto JSON agregado.');
  }
  return data;
}
const flags = process.argv.slice(2);
function arg(flag) {
  const index = flags.indexOf(flag);
  return index >= 0 ? flags[index + 1] : undefined;
}
const result = evaluateNicknameCutoverDecision({
  inventory: load(arg('--inventory')),
  indexScan: load(arg('--index-scan')),
  rollout: load(arg('--rollout')),
});
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'REVIEW_READY') process.exitCode = 2;
