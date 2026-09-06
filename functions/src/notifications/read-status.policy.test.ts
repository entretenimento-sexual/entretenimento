import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldResetGroupedCommunityActivityCount } from './read-status.policy';

test('zera o acumulador somente para atividade agrupada de Comunidade', () => {
  assert.equal(
    shouldResetGroupedCommunityActivityCount('community.comment.received'),
    true
  );
  assert.equal(
    shouldResetGroupedCommunityActivityCount('community.comment.reply.received'),
    true
  );
  assert.equal(
    shouldResetGroupedCommunityActivityCount('community.content.moderated'),
    false
  );
  assert.equal(shouldResetGroupedCommunityActivityCount('system'), false);
  assert.equal(shouldResetGroupedCommunityActivityCount(undefined), false);
});
