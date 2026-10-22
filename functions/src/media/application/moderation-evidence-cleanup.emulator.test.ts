import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { db } from '../../firebaseApp';
import {
  ensurePreservedModerationCleanupJob,
  MODERATION_EVIDENCE_COLLECTION,
  MODERATION_EVIDENCE_JOBS_COLLECTION,
} from './moderation-evidence-preservation.service';

const PROJECT_ID = 'demo-entretenimento-moderation-cleanup';
assert.equal(process.env.GCLOUD_PROJECT, PROJECT_ID);
assert.match(String(process.env.FIRESTORE_EMULATOR_HOST ?? ''), /^127\.0\.0\.1:\d{2,5}$/);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, process.env.MODERATION_CLEANUP_EXPECTED_EMULATOR_HOST);
assert.notEqual(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, '');

after(async () => { await db.terminate(); });

function refs() {
  const id = randomUUID();
  return {
    reportId: id,
    report: db.collection('moderation_reports').doc(id),
    evidence: db.collection(MODERATION_EVIDENCE_COLLECTION).doc(id),
    job: db.collection(MODERATION_EVIDENCE_JOBS_COLLECTION).doc(id),
  };
}

async function preserved(mediaType: 'PHOTO' | 'VIDEO') {
  const refsForTest = refs();
  const ownerUid = 'owner-' + randomUUID().slice(0, 12);
  const mediaId = 'media-' + randomUUID().slice(0, 12);
  await Promise.all([
    refsForTest.report.set({
      moderationAction: 'REMOVE',
      evidencePreservationStatus: 'PRESERVED',
      targetOwnerUid: ownerUid,
      targetType: mediaType.toLowerCase(),
      targetId: mediaId,
    }),
    refsForTest.evidence.set({ ownerUid, mediaId, mediaType, reason: 'SAFETY' }),
  ]);
  return { ...refsForTest, ownerUid, mediaId, mediaType };
}

for (const mediaType of ['PHOTO', 'VIDEO'] as const) {
  test(`${mediaType}: concurrent staging creates one durable cleanup obligation`, async () => {
    const x = await preserved(mediaType);
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      ensurePreservedModerationCleanupJob(x.reportId, x.mediaType, x.ownerUid, x.mediaId)));
    assert.deepEqual(results, [true, true, true, true]);
    const job = await x.job.get();
    assert.equal(job.get('status'), 'CLEANUP_PENDING');
    assert.equal(job.get('ownerUid'), x.ownerUid);
    assert.equal(job.get('mediaId'), x.mediaId);
    assert.equal(job.get('mediaType'), x.mediaType);
    assert.equal(job.get('attempts'), 0);
    const createdAt = job.get('createdAt');
    assert.equal(await ensurePreservedModerationCleanupJob(x.reportId, x.mediaType, x.ownerUid, x.mediaId), true);
    assert.equal((await x.job.get()).get('createdAt'), createdAt);
  });

  test(`${mediaType}: identity mismatch cannot hijack a staged cleanup job`, async () => {
    const x = await preserved(mediaType);
    await x.job.set({
      status: 'CLEANUP_PENDING', ownerUid: 'other-owner',
      mediaId: x.mediaId, mediaType, createdAt: Date.now(),
    });
    assert.equal(await ensurePreservedModerationCleanupJob(x.reportId, mediaType, x.ownerUid, x.mediaId), false);
    assert.equal((await x.job.get()).get('ownerUid'), 'other-owner');
    assert.equal(await ensurePreservedModerationCleanupJob(x.reportId, mediaType, x.ownerUid, 'other-media'), false);
  });

  test(`${mediaType}: report targeting another media cannot create cleanup job`, async () => {
    const x = await preserved(mediaType);
    await x.report.update({ targetId: 'different-media' });
    assert.equal(await ensurePreservedModerationCleanupJob(
      x.reportId, mediaType, x.ownerUid, x.mediaId
    ), false);
    assert.equal((await x.job.get()).exists, false);
    await x.report.update({ targetId: x.mediaId, targetType: 'other' });
    assert.equal(await ensurePreservedModerationCleanupJob(
      x.reportId, mediaType, x.ownerUid, x.mediaId
    ), false);
    assert.equal((await x.job.get()).exists, false);
  });

  test(`${mediaType}: rejected or unpreserved report never stages cleanup`, async () => {
    const x = await preserved(mediaType);
    await x.report.update({ moderationAction: 'KEEP' });
    assert.equal(await ensurePreservedModerationCleanupJob(x.reportId, mediaType, x.ownerUid, x.mediaId), false);
    assert.equal((await x.job.get()).exists, false);
    await x.report.update({ moderationAction: 'REMOVE', evidencePreservationStatus: 'PENDING' });
    assert.equal(await ensurePreservedModerationCleanupJob(x.reportId, mediaType, x.ownerUid, x.mediaId), false);
    assert.equal((await x.job.get()).exists, false);
  });
}
