import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const serviceSource = readFileSync(
  path.resolve(
    process.cwd(),
    'src',
    'community',
    'community-owner-terminal-succession.service.ts'
  ),
  'utf8'
);

test('sucessão automática nasce sem candidato e com prazo terminal', () => {
  for (const required of [
    "status: 'open'",
    'activeRequestId: null',
    'COMMUNITY_OWNER_TERMINAL_SUCCESSION_WINDOW_MS',
    "mode: 'terminal_succession'",
    "source: 'account-lifecycle-purge'",
  ]) {
    assert.equal(serviceSource.includes(required), true, required);
  }
});

test('serviço não contém promoção automática de admin/moderador', () => {
  for (const forbidden of [
    'promoteAdmin',
    'promoteModerator',
    'oldestMember',
    'mostActiveMember',
    'automaticSuccessor',
  ]) {
    assert.equal(serviceSource.includes(forbidden), false, forbidden);
  }
});
