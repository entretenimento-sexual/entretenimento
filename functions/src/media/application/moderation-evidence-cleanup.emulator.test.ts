import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { db, getDefaultStorageBucket } from '../../firebaseApp';
import { finishPreservedCleanup } from './moderation-evidence-preservation.handler';
import { finalizePhotoDeletionJob } from './photo-deletion-job-finalization';
import {
  deletePublishedPhotoAssetOrQueue,
  processPendingPublishedPhotoAssetCleanupJobs,
} from './published-photo-asset.service';
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

test('PUBLISHED PHOTO: stale cleanup retry cannot delete or update a replaced job', async () => {
  const ref = db.collection('media_published_asset_cleanup_jobs').doc(randomUUID());
  const original = {
    ownerUid: 'owner-a', photoId: 'photo-a', storagePath: 'published/old',
    createdAt: Date.now(), updatedAt: Date.now(), attempts: 1,
    state: 'retryable',
  };
  await ref.set(original);
  await ref.update({ updatedAt: original.updatedAt + 1, attempts: 2 });
  const attempt = async (action: 'delete' | 'update') => db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!current.exists ||
        current.get('ownerUid') !== original.ownerUid ||
        current.get('photoId') !== original.photoId ||
        current.get('storagePath') !== original.storagePath ||
        current.get('createdAt') !== original.createdAt ||
        current.get('updatedAt') !== original.updatedAt) return false;
    if (action === 'update' && current.get('attempts') !== original.attempts) return false;
    if (action === 'delete') tx.delete(ref);
    else tx.update(ref, { attempts: original.attempts + 1 });
    return true;
  });
  assert.equal(await attempt('delete'), false);
  assert.equal(await attempt('update'), false);
  const current = await ref.get();
  assert.equal(current.exists, true);
  assert.equal(current.get('attempts'), 2);
  assert.equal(current.get('updatedAt'), original.updatedAt + 1);
});

test('PUBLISHED PHOTO: real processor dead-letters invalid paths and purges expired jobs', async () => {
  const invalidRef = db.collection('media_published_asset_cleanup_jobs').doc(randomUUID());
  const expiredRef = db.collection('media_published_asset_cleanup_jobs').doc(randomUUID());
  const now = Date.now();
  await invalidRef.set({
    ownerUid: 'owner-a', photoId: 'photo-a',
    storagePath: 'invalid-unowned-path', reason: 'test',
    createdAt: now - 1000, updatedAt: now - 1000,
    attempts: 0, state: 'retryable', lastError: null,
    nextAttemptAt: now - 1000, deadLetterExpiresAt: null,
  });
  await expiredRef.set({
    ownerUid: 'owner-b', photoId: 'photo-b',
    storagePath: 'invalid-expired-path', reason: 'test',
    createdAt: now - 2000, updatedAt: now - 2000,
    attempts: 12, state: 'dead_letter', lastError: 'old failure',
    nextAttemptAt: null, deadLetterExpiresAt: now - 1000,
  });
  await processPendingPublishedPhotoAssetCleanupJobs(100);
  const invalid = await invalidRef.get();
  assert.equal(invalid.get('state'), 'dead_letter');
  assert.equal(invalid.get('nextAttemptAt'), null);
  assert.equal((await expiredRef.get()).exists, false);
});

test('PUBLISHED PHOTO: direct cleanup removes the physical Storage object', async () => {
  assert.match(
    String(process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? ''),
    /^127\.0\.0\.1:\d{2,5}$/
  );
  const ownerUid = randomUUID();
  const photoId = randomUUID();
  const storagePath = `users/${ownerUid}/published/images/${photoId}/${randomUUID()}`;
  const file = getDefaultStorageBucket().file(storagePath);
  await file.save(Buffer.from('cleanup-emulator-fixture'), { resumable: false });
  assert.equal((await file.exists())[0], true);
  const deleted = await deletePublishedPhotoAssetOrQueue({
    ownerUid, photoId, storagePath, reason: 'test-physical-cleanup',
  });
  assert.equal(deleted, true);
  assert.equal((await file.exists())[0], false);
});

test('PUBLISHED PHOTO: retry processor deletes physical file and acknowledges job', async () => {
  const ownerUid = randomUUID();
  const photoId = randomUUID();
  const storagePath = `users/${ownerUid}/published/images/${photoId}/${randomUUID()}`;
  const file = getDefaultStorageBucket().file(storagePath);
  await file.save(Buffer.from('retry-emulator-fixture'), { resumable: false });
  const [metadata] = await file.getMetadata();
  const jobId = createHash('sha256').update(storagePath).digest('hex');
  const jobRef = db.collection('media_published_asset_cleanup_jobs').doc(jobId);
  const now = Date.now();
  await jobRef.set({
    ownerUid, photoId, storagePath, generation: String(metadata.generation),
    reason: 'test-retry-after-failure',
    createdAt: now - 2000, updatedAt: now - 1000,
    attempts: 1, state: 'retryable', lastError: 'simulated prior storage outage',
    nextAttemptAt: now - 1000, deadLetterExpiresAt: null,
  });
  assert.equal((await file.exists())[0], true);
  await processPendingPublishedPhotoAssetCleanupJobs(100);
  assert.equal((await file.exists())[0], false);
  assert.equal((await jobRef.get()).exists, false);
});

test('PUBLISHED PHOTO: physical delete failure persists job then real retry recovers', async () => {
  const ownerUid = randomUUID();
  const photoId = randomUUID();
  const storagePath = `users/${ownerUid}/published/images/${photoId}/${randomUUID()}`;
  const file = getDefaultStorageBucket().file(storagePath);
  await file.save(Buffer.from('physical-failure-fixture'), { resumable: false });
  const jobId = createHash('sha256').update(storagePath).digest('hex');
  const jobRef = db.collection('media_published_asset_cleanup_jobs').doc(jobId);
  const prototype = Object.getPrototypeOf(file) as { delete: typeof file.delete };
  const originalDelete = prototype.delete;
  let injected = false;
  try {
    prototype.delete = async function (this: typeof file, ...args: Parameters<typeof file.delete>) {
      if (this.name === storagePath && !injected) {
        injected = true;
        throw new Error('injected temporary storage outage');
      }
      return originalDelete.apply(this, args);
    } as unknown as typeof file.delete;
    const result = await deletePublishedPhotoAssetOrQueue({
      ownerUid, photoId, storagePath, reason: 'test-physical-failure-recovery',
    });
    assert.equal(result, false);
  } finally {
    prototype.delete = originalDelete;
  }
  assert.equal(injected, true);
  const pending = await jobRef.get();
  assert.equal(pending.exists, true);
  assert.equal(pending.get('state'), 'retryable');
  assert.equal(pending.get('attempts'), 1);
  assert.equal((await file.exists())[0], true);
  await jobRef.update({ nextAttemptAt: Date.now() - 1000 });
  await processPendingPublishedPhotoAssetCleanupJobs(100);
  assert.equal((await file.exists())[0], false);
  assert.equal((await jobRef.get()).exists, false);
});

test('PUBLISHED PHOTO: physical cleanup cannot acknowledge a replaced job', async () => {
  const ownerUid = randomUUID();
  const photoId = randomUUID();
  const storagePath = `users/${ownerUid}/published/images/${photoId}/${randomUUID()}`;
  const file = getDefaultStorageBucket().file(storagePath);
  await file.save(Buffer.from('concurrent-cleanup-fixture'), { resumable: false });
  const [metadata] = await file.getMetadata();
  const jobId = createHash('sha256').update(storagePath).digest('hex');
  const jobRef = db.collection('media_published_asset_cleanup_jobs').doc(jobId);
  const now = Date.now();
  await jobRef.set({
    ownerUid, photoId, storagePath, generation: String(metadata.generation),
    reason: 'old-cleanup',
    createdAt: now - 1000, updatedAt: now - 1000,
    attempts: 1, state: 'retryable', lastError: 'old failure',
    nextAttemptAt: now - 1000, deadLetterExpiresAt: null,
  });
  const prototype = Object.getPrototypeOf(file) as { delete: typeof file.delete };
  const originalDelete = prototype.delete;
  let replaced = false;
  try {
    prototype.delete = async function (this: typeof file, ...args: Parameters<typeof file.delete>) {
      if (this.name === storagePath && !replaced) {
        replaced = true;
        await jobRef.update({
          reason: 'new-cleanup', updatedAt: now + 1000,
          attempts: 0, nextAttemptAt: null,
        });
      }
      return originalDelete.apply(this, args);
    } as unknown as typeof file.delete;
    await processPendingPublishedPhotoAssetCleanupJobs(100);
  } finally {
    prototype.delete = originalDelete;
  }
  assert.equal(replaced, true);
  assert.equal((await file.exists())[0], false);
  const current = await jobRef.get();
  assert.equal(current.exists, true);
  assert.equal(current.get('reason'), 'new-cleanup');
  assert.equal(current.get('updatedAt'), now + 1000);
  await jobRef.delete();
});

test('PUBLISHED PHOTO: direct physical cleanup preserves a concurrently replaced job', async () => {
  const ownerUid = randomUUID();
  const photoId = randomUUID();
  const storagePath = `users/${ownerUid}/published/images/${photoId}/${randomUUID()}`;
  const file = getDefaultStorageBucket().file(storagePath);
  await file.save(Buffer.from('direct-concurrent-cleanup'), { resumable: false });
  const jobId = createHash('sha256').update(storagePath).digest('hex');
  const jobRef = db.collection('media_published_asset_cleanup_jobs').doc(jobId);
  const now = Date.now();
  await jobRef.set({
    ownerUid, photoId, storagePath, reason: 'initial-cleanup',
    createdAt: now - 1000, updatedAt: now - 1000,
    attempts: 0, state: 'retryable', lastError: null,
    nextAttemptAt: now - 1000, deadLetterExpiresAt: null,
  });
  const prototype = Object.getPrototypeOf(file) as { delete: typeof file.delete };
  const originalDelete = prototype.delete;
  let replaced = false;
  try {
    prototype.delete = async function (this: typeof file, ...args: Parameters<typeof file.delete>) {
      if (this.name === storagePath && !replaced) {
        replaced = true;
        await jobRef.update({
          reason: 'replacement-cleanup', updatedAt: now + 1000,
          attempts: 0, nextAttemptAt: null,
        });
      }
      return originalDelete.apply(this, args);
    } as unknown as typeof file.delete;
    assert.equal(await deletePublishedPhotoAssetOrQueue({
      ownerUid, photoId, storagePath, reason: 'initial-cleanup',
    }), true);
  } finally {
    prototype.delete = originalDelete;
  }
  assert.equal(replaced, true);
  assert.equal((await file.exists())[0], false);
  const current = await jobRef.get();
  assert.equal(current.exists, true);
  assert.equal(current.get('reason'), 'replacement-cleanup');
  await jobRef.delete();
});

test('PUBLISHED PHOTO: legacy cleanup without pinned generation fails closed', async () => {
  const ownerUid = randomUUID();
  const photoId = randomUUID();
  const storagePath = `users/${ownerUid}/published/images/${photoId}/${randomUUID()}`;
  const file = getDefaultStorageBucket().file(storagePath);
  await file.save(Buffer.from('legacy-generation-still-present'), { resumable: false });
  const jobId = createHash('sha256').update(storagePath).digest('hex');
  const jobRef = db.collection('media_published_asset_cleanup_jobs').doc(jobId);
  const now = Date.now();
  await jobRef.set({
    ownerUid, photoId, storagePath, reason: 'legacy-unknown-generation',
    createdAt: now - 2000, updatedAt: now - 1000, attempts: 1,
    state: 'retryable', lastError: null, nextAttemptAt: now - 1000,
    deadLetterExpiresAt: null,
  });
  await processPendingPublishedPhotoAssetCleanupJobs(100);
  assert.equal((await file.exists())[0], true);
  const current = await jobRef.get();
  assert.equal(current.get('state'), 'dead_letter');
  assert.equal(current.get('nextAttemptAt'), null);
  assert.equal(current.get('deadLetterExpiresAt'), null);
  await jobRef.delete();
});

test('PUBLISHED PHOTO: direct cleanup pins GCS generation in delete request', async () => {
  const ownerUid = randomUUID();
  const photoId = randomUUID();
  const storagePath = `users/${ownerUid}/published/images/${photoId}/${randomUUID()}`;
  const file = getDefaultStorageBucket().file(storagePath);
  await file.save(Buffer.from('pinned-direct-delete'), { resumable: false });
  const [metadata] = await file.getMetadata();
  const prototype = Object.getPrototypeOf(file) as { delete: typeof file.delete };
  const originalDelete = prototype.delete;
  let checked = false;
  try {
    prototype.delete = async function (this: typeof file, ...args: Parameters<typeof file.delete>) {
      if (this.name === storagePath) {
        checked = true;
        assert.equal((args[0] as unknown as { ifGenerationMatch?: string })?.ifGenerationMatch,
          String(metadata.generation));
      }
      return originalDelete.apply(this, args);
    } as unknown as typeof file.delete;
    assert.equal(await deletePublishedPhotoAssetOrQueue({
      ownerUid, photoId, storagePath, reason: 'test-pinned-direct-delete',
    }), true);
  } finally {
    prototype.delete = originalDelete;
  }
  assert.equal(checked, true);
  assert.equal((await file.exists())[0], false);
});

test('PUBLISHED PHOTO: generation conflict blocks deletion and durable retry', async () => {
  const ownerUid = randomUUID();
  const photoId = randomUUID();
  const storagePath = `users/${ownerUid}/published/images/${photoId}/${randomUUID()}`;
  const file = getDefaultStorageBucket().file(storagePath);
  await file.save(Buffer.from('replacement-must-survive'), { resumable: false });
  const [metadata] = await file.getMetadata();
  const jobId = createHash('sha256').update(storagePath).digest('hex');
  const jobRef = db.collection('media_published_asset_cleanup_jobs').doc(jobId);
  const prototype = Object.getPrototypeOf(file) as { delete: typeof file.delete };
  const originalDelete = prototype.delete;
  let checked = false;
  try {
    prototype.delete = async function (this: typeof file, ...args: Parameters<typeof file.delete>) {
      if (this.name === storagePath) {
        checked = true;
        assert.equal((args[0] as unknown as { ifGenerationMatch?: string })?.ifGenerationMatch,
          String(metadata.generation));
        throw Object.assign(new Error('simulated GCS generation conflict'), { code: 412 });
      }
      return originalDelete.apply(this, args);
    } as unknown as typeof file.delete;
    assert.equal(await deletePublishedPhotoAssetOrQueue({
      ownerUid, photoId, storagePath, reason: 'test-generation-conflict',
    }), false);
  } finally {
    prototype.delete = originalDelete;
  }
  assert.equal(checked, true);
  assert.equal((await file.exists())[0], true);
  const job = await jobRef.get();
  assert.equal(job.get('generation'), String(metadata.generation));
  assert.equal(job.get('state'), 'dead_letter');
  assert.equal(job.get('nextAttemptAt'), null);
  await jobRef.delete();
});

test('PUBLISHED PHOTO: Storage emulator does not enforce create-only preconditions', async () => {
  // This emulator currently accepts an overwrite despite ifGenerationMatch: 0.
  // Production create-only safety must be verified against real Cloud Storage.
  const ownerUid = randomUUID();
  const photoId = randomUUID();
  const path = `users/${ownerUid}/published/images/${photoId}/${randomUUID()}`;
  const file = getDefaultStorageBucket().file(path);
  await file.save(Buffer.from('original-generation'), { resumable: false });
  const [metadata] = await file.getMetadata();
  assert.ok(metadata.generation);
  // Do not assert a rejected second save: the emulator does not model this.
  const [contents] = await file.download();
  assert.equal(contents.toString(), 'original-generation');
});
