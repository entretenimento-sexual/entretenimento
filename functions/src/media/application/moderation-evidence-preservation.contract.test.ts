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

test('invalid evidence source stages a durable blocked job atomically', () => {
  assert.match(source, /status: 'BLOCKED_SOURCE_PATH'/);
  assert.match(source, /lastErrorCode: 'INVALID_SOURCE_PATH'/);
  assert.match(source, /stageModerationEvidenceJobInFirestore\(db, reportId/);
  assert.match(source, /tx\.set\(jobRef, job, \{ merge: true \}\)/);
  assert.match(source, /tx\.set\(reportRef/);
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

test('evidence copy pins the source version and requires create-only destination', () => {
  const preserve = source.slice(
    source.indexOf('export async function preserveModerationEvidence('),
    source.indexOf('export async function ensurePreservedModerationCleanupJob(')
  );
  assert.match(preserve, /normalizeGcsGeneration\(sourceMetadata\.generation\)/);
  assert.match(preserve, /generation: sourceGeneration/);
  assert.match(preserve, /preconditionOpts: \{ ifGenerationMatch: 0 \}/);
  assert.match(preserve, /sourceCrc32c !== evidenceCrc32c/);
  assert.match(preserve, /ifGenerationMatch: generation/);
  assert.doesNotMatch(preserve, /sourceFile\.copy\(destinationFile\)/);
});

test('release blocks legacy generations, unexpected paths and version replacement', () => {
  const release = source.slice(source.indexOf('export async function releaseModerationEvidence('));
  assert.match(release, /normalizeGcsGeneration\(evidenceBefore\.get\('evidenceGeneration'\)\)/);
  assert.match(release, /entry\.generation !== recordedGeneration/);
  assert.match(release, /ifGenerationMatch: generation/);
  assert.doesNotMatch(release, /\.delete\(\{ ignoreNotFound: true \}\)/);
});

test('release retains Firestore obligation after GCS failure or changed identity', () => {
  const release = source.slice(source.indexOf('export async function releaseModerationEvidence('));
  assert.match(release, /await Promise\.all\(/);
  assert.doesNotMatch(release, /Promise\.allSettled/);
  assert.match(release, /await db\.runTransaction\(async tx =>/);
  assert.match(release, /unchanged\(evidenceBefore, evidenceCurrent\)/);
  assert.match(release, /unchanged\(jobBefore, jobCurrent\)/);
  assert.match(release, /tx\.delete\(evidenceRef\)/);
  assert.match(release, /tx\.delete\(jobRef\)/);
});

test('preserved REMOVE retains retryable cleanup obligation', () => {
  assert.match(source, /status: 'CLEANUP_PENDING', updatedAt: Date\.now\(\)/);
  assert.match(retry, /\.where\('status', '==', 'CLEANUP_PENDING'\)/);
  assert.match(retry, /await finishPreservedCleanup\(cleanup\.id\)/);
  assert.match(retry, /job\.get\('status'\) === 'CLEANUP_PENDING'/);
});

test('moderation cleanup acknowledges only completed physical deletion', () => {
  assert.match(retry, /const result = await deleteProfilePhotoResources/);
  assert.match(retry, /const result = await deleteProfileVideoResources/);
  assert.match(retry, /return result\.cleanupPending === false/g);
  assert.match(retry, /if \(!await cleanup\(reportId, identity\)\) return/);
});

test('previously preserved REMOVE stages durable cleanup before deletion', () => {
  assert.match(source, /export async function ensurePreservedModerationCleanupJob/);
  assert.match(source, /tx\.create\(jobRef/);
  assert.match(source, /evidence\.get\('mediaId'\) !== mediaId/);
  assert.match(source, /evidence\.get\('mediaType'\) !== mediaType/);
});

test('cleanup retry validates report and evidence identity before deletion', () => {
  assert.match(retry, /const jobBefore = await jobRef\.get\(\)/);
  assert.match(retry, /matchingCleanupIdentity\(jobBefore, identity\)/);
  assert.match(retry, /evidenceSnap\.get\('ownerUid'\) !== identity\.ownerUid/);
  assert.match(retry, /evidenceSnap\.get\('mediaId'\) !== identity\.mediaId/);
  assert.match(retry, /evidenceSnap\.get\('mediaType'\) !== identity\.mediaType/);
});

test('cleanup retry does not acknowledge a replaced obligation or changed target', () => {
  assert.match(retry, /await db\.runTransaction\(async \(tx\) =>/);
  assert.match(retry, /matchingCleanupIdentity\(job, identity\)/);
  assert.match(retry, /job\.get\('createdAt'\) === identity\.createdAt/);
  assert.match(retry, /reportMediaId === identity\.mediaId/);
  assert.match(retry, /evidence\.get\('mediaId'\) === identity\.mediaId/);
  assert.match(retry, /\) tx\.delete\(jobRef\)/);
});

test('G5-B3: cleanup requires generation proven by copy response', () => {
  const preserve = source.slice(
    source.indexOf('export async function preserveModerationEvidence('),
    source.indexOf('export async function ensurePreservedModerationCleanupJob(')
  );
  assert.match(preserve, /const \[copiedFile, copyApiResponse\]/);
  assert.match(preserve, /createdEvidenceGeneration = apiGeneration \?\? fileGeneration/);
  assert.doesNotMatch(preserve, /createdEvidenceGeneration = observedEvidenceGeneration/);
  assert.match(preserve, /if \(!observedEvidenceGeneration \|\|/);
  assert.match(preserve, /finalizeResult === 'RELEASED' && copyCompletedInThisAttempt/);
  assert.match(preserve, /if \(!createdEvidenceGeneration\)/);
});

test('G5-B4.2: release intent and preservation claims are durable', () => {
  const preserve = source.slice(source.indexOf('export async function preserveModerationEvidence('),
    source.indexOf('export async function ensurePreservedModerationCleanupJob('));
  const release = source.slice(source.indexOf('export async function releaseModerationEvidence('));
  assert.match(preserve, /beginModerationEvidencePreservationAttemptInFirestore/);
  assert.match(preserve, /endModerationEvidencePreservationAttemptInFirestore/);
  assert.match(release, /evidencePreservationStatus: 'RELEASING'/);
  assert.match(release, /evidencePreservationStatus: 'RELEASED'/);
  assert.match(release, /activeOps\(job\)/);
  assert.match(release, /ifGenerationMatch: generation/);
});
