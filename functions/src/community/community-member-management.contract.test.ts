import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const memberManagementHandlerPath = path.resolve(
  __dirname,
  '../../src/community/community-member-management.handler.ts'
);

function readUnblockBranch(): string {
  const source = readFileSync(memberManagementHandlerPath, 'utf8');
  const startMarker = "} else if (action === 'unblock') {";
  const endMarker = "} else if (action === 'set_role') {";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(
    start,
    -1,
    'O contrato deve encontrar o ramo de unblock no handler.'
  );
  assert.notEqual(
    end,
    -1,
    'O contrato deve encontrar o fim do ramo de unblock no handler.'
  );

  return source.slice(start, end);
}

test('unblock conclui o vínculo em left com timestamp e limpa metadados de bloqueio', () => {
  const branch = readUnblockBranch();

  assert.match(
    branch,
    /update\['leftAt'\]\s*=\s*now;/,
    'blocked -> left deve gravar leftAt no mesmo instante da transição.'
  );
  assert.match(
    branch,
    /update\['unblockedAt'\]\s*=\s*now;/,
    'O desbloqueio deve preservar seu marco temporal próprio.'
  );

  for (const field of [
    'blockedAt',
    'blockedBy',
    'blockedByRole',
    'blockedPreviousRole',
  ]) {
    assert.match(
      branch,
      new RegExp(`update\\['${field}'\\]\\s*=\\s*FieldValue\\.delete\\(\\);`),
      `O desbloqueio deve limpar ${field}.`
    );
  }
});
