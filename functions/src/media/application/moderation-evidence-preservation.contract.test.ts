import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(join(
  __dirname, '../../../src/media/application/moderation-evidence-preservation.service.ts'
), 'utf8');
const retry = readFileSync(join(
  __dirname, '../../../src/media/application/moderation-evidence-preservation.handler.ts'
), 'utf8');

test('invalid evidence source records durable blocked job and pending report atomically', () => {
  assert.match(source, /status: 'BLOCKED_SOURCE_PATH'/);
  assert.match(source, /lastErrorCode: 'INVALID_SOURCE_PATH'/);
  assert.match(source, /batch\.set\(db\.collection\(MODERATION_EVIDENCE_JOBS_COLLECTION\)/);
  assert.match(source, /batch\.set\(reportRef/);
  assert.match(source, /await batch\.commit\(\)/);
});
test('retry scans actionable pending jobs without starvation from blocked evidence', () => {
  assert.match(retry, /\.where\('status', '==', 'PENDING'\)/);
  assert.match(retry, /await preserveModerationEvidence\(jobDoc\.id\)/);
  assert.match(retry, /await cleanupResolvedRemovedMedia\(jobDoc\.id\)/);
});

test('blocked evidence rearms exclusively from published canonical media', () => {
  assert.match(source, /rearmBlockedModerationEvidenceFromPublication/);
  assert.match(source, /reportSnap\.get\('moderationAction'\) !== 'REMOVE'/);
  assert.match(source, /publicationSnap\.get\('publishedStoragePath'\)/);
  assert.match(source, /publicationSnap\.get\('isPublished'\) !== true/);
  assert.match(retry, /\.where\('status', '==', 'BLOCKED_SOURCE_PATH'\)/);
});
