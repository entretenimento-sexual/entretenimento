import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const admission = readFileSync('docs/operations/adult-admission-legal-gating.md', 'utf8');
const legacy = readFileSync('docs/operations/adult-consent-legacy-reconciliation.md', 'utf8');
const cutover = readFileSync('docs/operations/adult-consent-cutover-decision-3-2c4.md', 'utf8');

const leading = (text) => text.slice(0, 1700);

test('política vigente marca v1 como histórico e mantém 18+, termos e lifecycle', () => {
  assert.match(leading(admission), /Estado vigente em 10\/11\/2026/);
  assert.match(admission, /campos históricos protegidos/);
  assert.match(admission, /Account Lifecycle/);
  assert.match(admission, /Termos vigentes/);
  assert.match(admission, /admissão etária canônica/);
});

test('documento de reconciliação anterior está explicitamente superado', () => {
  assert.match(leading(legacy), /DOCUMENTO HISTÓRICO/);
  assert.match(leading(legacy), /não representam o fluxo vigente/);
  assert.match(legacy, /adultConsent\.version = v1/);
  assert.match(legacy, /Decisão superveniente/);
});

test('cutover bloqueia remoção da callable sem prova e conserva históricos', () => {
  assert.match(leading(cutover), /NO-GO/);
  assert.match(cutover, /acceptAdultConsent/);
  assert.match(cutover, /desconhecidos/);
  assert.match(cutover, /Não excluir Functions implantadas/);
  assert.match(cutover, /Nunca gravar aceites fictícios/);
  assert.match(cutover, /rollback/);
  assert.match(cutover, /E2E\/CI isolados/);
});

test('nenhum documento autoriza deploy ou declara uso zero sem evidência', () => {
  assert.match(leading(admission), /não comitadas nem implantadas/);
  assert.match(leading(legacy), /despublicação não está autorizada/);
  assert.match(cutover, /não inferir zero chamadas/);
  assert.match(cutover, /autorização explícita/);
});
