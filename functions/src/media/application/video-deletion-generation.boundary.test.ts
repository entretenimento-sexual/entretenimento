import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const handler = readFileSync(
  join(__dirname, '../../../src/media/application/delete-profile-video.handler.ts'),
  'utf8'
);

test('processed video deletion pins every listed object to its own GCS generation', () => {
  assert.match(handler, /deleteGenerationPinnedVideoFile\(\s*file\.metadata\?\.generation,/);
  assert.match(handler, /ifGenerationMatch: generation/);
  assert.match(handler, /VideoDeletionGenerationConflictError/);
  assert.match(handler, /kind: 'BLOCKED'/);
  assert.doesNotMatch(handler, /delete:s*\(\)s*=>s*file\.delete\(\{s*ignoreNotFound:s*trues*\}\)/);
});
