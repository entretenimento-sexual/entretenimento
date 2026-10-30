// A chave privada só pode sair da projeção pública quando ambas as
// fronteiras (migração no backend e GET nas regras) concordarem.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const projection = readFileSync(resolve(root,
  'functions/src/discovery/public-profile-discovery-projection.ts'), 'utf8');
const rules = readFileSync(resolve(root,
  'firestore-rules/public_profiles_next.rules'), 'utf8');

const backend = projection.match(
  /export const PRIVATE_DISCOVERY_INTEREST_FIELDS = \[([\s\S]*?)\] as const;/
);
const firestore = rules.match(
  /function lacksPrivateDiscoveryInterestFields\(\) \{[\s\S]*?hasAny\(\[([\s\S]*?)\]\)/
);
if (!backend || !firestore) {
  console.error('[discovery:fields] FAIL: não foi possível identificar ambos os contratos.');
  process.exit(1);
}
const parse = text => [...text.matchAll(/['"]([a-zA-Z][a-zA-Z0-9]*)['"]/g)]
  .map(match => match[1]).sort();
const backendFields = parse(backend[1]);
const ruleFields = parse(firestore[1]);
if (backendFields.length === 0
  || backendFields.length !== new Set(backendFields).size
  || ruleFields.length !== new Set(ruleFields).size
  || JSON.stringify(backendFields) !== JSON.stringify(ruleFields)) {
  console.error('[discovery:fields] FAIL: campos privados divergem entre Functions e Rules.');
  process.exit(1);
}
console.log('[discovery:fields] OK:', backendFields.length,
  'chaves privadas protegidas nas duas fronteiras.');
