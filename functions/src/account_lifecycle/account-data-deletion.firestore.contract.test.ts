import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourcePath = path.resolve(
  __dirname,
  '../../src/account_lifecycle/account-data-deletion.firestore.ts'
);
const source = readFileSync(sourcePath, 'utf8');

test('account purge removes private Community notification trees before finalization', () => {
  assert.match(
    source,
    /community_notification_projection_state/
  );
  assert.match(
    source,
    /direction === 'recipient' && snapshot\.size < limit[\s\S]*community_notification_summaries/
  );
  assert.match(
    source,
    /recursiveDelete\([\s\S]*community_notification_preferences/
  );
});

test('actor-side notification cleanup keeps projection state for recipient convergence', () => {
  assert.match(
    source,
    /const projectionStateRefs = direction === 'recipient'[\s\S]*:\s*\[\];/
  );
});
