import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(
    path.resolve(process.cwd(), 'src', 'community', relativePath),
    'utf8'
  );
}

test('indicação terminal preserva staff executor sem fingir ação do owner ausente', () => {
  const workflow = source(
    'community-ownership-transfer.workflow.handler.ts'
  );

  assert.equal(workflow.includes('requestedByUid: actorUid'), true);
  assert.equal(workflow.includes('createdByUid: requestedByUid'), true);
  assert.equal(workflow.includes('actorUid: requestedByUid'), true);
  assert.equal(
    workflow.includes(
      'Você foi indicado para assumir ${communityName} em um processo de sucessão protegido.'
    ),
    true
  );
});

test('arquivamento terminal reconcilia memberCount antes de liberar ownership', () => {
  const lifecycle = source(
    'run-community-ownership-succession.schedule.ts'
  );

  assert.equal(
    lifecycle.includes(
      "resolveCommunityMemberCountDelta(metrics['memberCount'], -1)"
    ),
    true
  );
  assert.equal(
    lifecycle.includes("'metrics.memberCount': nextMemberCount"),
    true
  );
  assert.equal(
    lifecycle.includes(
      'community_ownership_succession_member_count_inconsistent'
    ),
    true
  );
});

test('fonte legada não expõe callable de transferência imediata', () => {
  const legacy = source(
    'community-ownership-lifecycle.handler.ts'
  );

  assert.equal(
    legacy.includes('export const transferCommunityOwnership ='),
    false
  );
});
