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
  assert.match(retry, /await finishPreservedCleanup\(jobDoc\.id\)/);
});

test('blocked evidence rearms exclusively from published canonical media', () => {
  assert.match(source, /rearmBlockedModerationEvidenceFromPublication/);
  assert.match(source, /reportSnap\.get\('moderationAction'\) !== 'REMOVE'/);
  assert.match(source, /publicationSnap\.get\('publishedStoragePath'\)/);
  assert.match(source, /publicationSnap\.get\('isPublished'\) !== true/);
  assert.match(retry, /\.where\('status', '==', 'BLOCKED_SOURCE_PATH'\)/);
});

test('physical evidence mismatch prevents preservation finalization', () => {
  assert.match(source, /sourceMd5 !== evidenceMd5/);
  assert.match(source, /sourceCrc32c !== evidenceCrc32c/);
  assert.match(source, /Number\(sourceMetadata\.size\) !== Number\(evidenceMetadata\.size\)/);
  assert.match(source, /Evidência preservada diverge do arquivo denunciado/);
});

test('evidence release fails closed and commits Firestore state atomically', () => {
  const release = source.slice(source.indexOf('export async function releaseModerationEvidence('));
  assert.match(release, /await Promise\.all\(/);
  assert.doesNotMatch(release, /Promise\.allSettled/);
  assert.match(release, /batch\.delete\(evidenceRef\)/);
  assert.match(release, /batch\.delete\(db\.collection\(MODERATION_EVIDENCE_JOBS_COLLECTION\)/);
  assert.match(release, /await batch\.commit\(\)/);
});

test('preserved REMOVE retains retryable cleanup obligation', () => {
  assert.match(source, /status: 'CLEANUP_PENDING', updatedAt: Date\.now\(\)/);
  assert.match(retry, /\.where\('status', '==', 'CLEANUP_PENDING'\)/);
  assert.match(retry, /await finishPreservedCleanup\(cleanup\.id\)/);
  assert.match(retry, /if \(job\.get\('status'\) === 'CLEANUP_PENDING'\)/);
});

test('moderation cleanup acknowledges only completed physical deletion', () => {
  assert.match(retry, /const result = await deleteProfilePhotoResources/);
  assert.match(retry, /const result = await deleteProfileVideoResources/);
  assert.match(retry, /return result\.cleanupPending === false/g);
  assert.match(retry, /if \(!await cleanupResolvedRemovedMedia\(reportId\)\) return/);
});
