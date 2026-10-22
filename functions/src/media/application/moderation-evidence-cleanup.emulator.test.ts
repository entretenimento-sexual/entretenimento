import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { db } from '../../firebaseApp';
import { finishPreservedCleanup } from './moderation-evidence-preservation.handler';
import { finalizePhotoDeletionJob } from './photo-deletion-job-finalization';
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

for (const mediaType of ['PHOTO', 'VIDEO'] as const) {
  test(`${mediaType}: failed deletion retains durable job, retry only acknowledges confirmed cleanup`, async () => {
    const x = await preserved(mediaType);
    assert.equal(await ensurePreservedModerationCleanupJob(
      x.reportId, mediaType, x.ownerUid, x.mediaId
    ), true);
    let calls = 0;
    await assert.rejects(finishPreservedCleanup(x.reportId, async () => {
      calls++;
      throw new Error('simulated-storage-outage');
    }), /simulated-storage-outage/);
    assert.equal((await x.job.get()).get('status'), 'CLEANUP_PENDING');
    await finishPreservedCleanup(x.reportId, async () => {
      calls++;
      return false;
    });
    assert.equal((await x.job.get()).get('status'), 'CLEANUP_PENDING');
    await finishPreservedCleanup(x.reportId, async () => {
      calls++;
      return true;
    });
    assert.equal((await x.job.get()).exists, false);
    assert.equal(calls, 3);
  });

  test(`${mediaType}: replaced cleanup job cannot be acknowledged after successful deletion`, async () => {
    const x = await preserved(mediaType);
    await ensurePreservedModerationCleanupJob(x.reportId, mediaType, x.ownerUid, x.mediaId);
    await finishPreservedCleanup(x.reportId, async () => {
      await x.job.update({ createdAt: Date.now() + 999999 });
      return true;
    });
    assert.equal((await x.job.get()).get('status'), 'CLEANUP_PENDING');
  });

  test(`${mediaType}: changed evidence prevents cleanup acknowledgement`, async () => {
    const x = await preserved(mediaType);
    await ensurePreservedModerationCleanupJob(x.reportId, mediaType, x.ownerUid, x.mediaId);
    await finishPreservedCleanup(x.reportId, async () => {
      await x.evidence.update({ mediaId: 'replaced-media' });
      return true;
    });
    assert.equal((await x.job.get()).get('status'), 'CLEANUP_PENDING');
  });
}

test('PHOTO: concurrent finalizers only acknowledge the matching persisted obligation', async () => {
  const id = randomUUID();
  const ref = db.collection('media_photo_deletion_jobs').doc(id);
  const identity = {
    ownerUid: 'owner-' + randomUUID().slice(0, 12),
    photoId: 'photo-' + randomUUID().slice(0, 12),
    storagePath: 'users/photo-test/private/' + id,
    createdAt: Date.now(),
  };
  await ref.set({ ...identity, state: 'retryable', attempts: 2 });
  const outcomes = await Promise.all([
    finalizePhotoDeletionJob(db, id, identity),
    finalizePhotoDeletionJob(db, id, identity),
  ]);
  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal((await ref.get()).exists, false);
});

test('PHOTO: stale finalizer cannot remove a replaced job', async () => {
  const id = randomUUID();
  const ref = db.collection('media_photo_deletion_jobs').doc(id);
  const identity = {
    ownerUid: 'owner-' + randomUUID().slice(0, 12),
    photoId: 'photo-' + randomUUID().slice(0, 12),
    storagePath: 'users/photo-test/private/' + id,
    createdAt: Date.now(),
  };
  await ref.set({ ...identity, state: 'retryable', attempts: 1 });
  await ref.update({ createdAt: identity.createdAt + 1, attempts: 3 });
  await assert.rejects(
    finalizePhotoDeletionJob(db, id, identity),
    /photo-deletion-job-identity-changed/
  );
  const current = await ref.get();
  assert.equal(current.get('attempts'), 3);
  assert.equal(current.get('createdAt'), identity.createdAt + 1);
});

test('PHOTO: an upload transaction cannot register the same ID while deletion is pending', async () => {
  const ownerUid = 'owner-' + randomUUID().slice(0, 12);
  const photoId = 'photo-' + randomUUID().slice(0, 12);
  const job = db.collection('media_photo_deletion_jobs').doc(`${ownerUid}_${photoId}`);
  const photo = db.doc(`users/${ownerUid}/photos/${photoId}`);
  await job.set({
    ownerUid, photoId, storagePath: `users/${ownerUid}/private/${photoId}`,
    createdAt: Date.now(), state: 'retryable', attempts: 1,
  });
  const register = () => db.runTransaction(async transaction => {
    const [existingPhoto, existingDeletion] = await Promise.all([
      transaction.get(photo), transaction.get(job),
    ]);
    if (existingDeletion.exists) throw new Error('photo-cleanup-pending');
    if (existingPhoto.exists) throw new Error('photo-already-exists');
    transaction.create(photo, { path: 'new-upload' });
  });
  const results = await Promise.allSettled([register(), register()]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected']);
  for (const result of results) {
    if (result.status === 'rejected') assert.match(String(result.reason), /photo-cleanup-pending/);
  }
  assert.equal((await photo.get()).exists, false);
  assert.equal((await job.get()).get('attempts'), 1);
});
