import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId = 'demo-entretenimento-media-e2e';
const bucketName = `${projectId}.appspot.com`;
process.env.GCLOUD_PROJECT = projectId;
process.env.GCP_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:18080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:19199';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:19099';

const app = initializeApp({
  credential: applicationDefault(),
  projectId,
  storageBucket: bucketName,
});
const { preserveModerationEvidence } = await import(
  '../../functions/lib/media/application/moderation-evidence-preservation.service.js'
);
const db = getFirestore(app);
const bucket = getStorage(app).bucket();
const suffix = randomUUID();
const ownerUid = `evidence-retry-${suffix}`;
const mediaId = `video-${suffix}`;
const reportId = `report-${suffix}`;
const sourcePath = `users/${ownerUid}/published/videos/${mediaId}/assets/v1`;
const evidencePath = `system/moderation-evidence/${reportId}/video`;
const job = db.doc(`moderation_evidence_preservation_jobs/${reportId}`);
const report = db.doc(`moderation_reports/${reportId}`);
const evidence = db.doc(`moderation_evidence/${reportId}`);
const sourceFile = bucket.file(sourcePath);
const evidenceFile = bucket.file(evidencePath);
const bytes = Buffer.from(`preservation-recovery-${suffix}`);

try {
  await Promise.all([
    job.set({
      reportId, ownerUid, mediaId, mediaType: 'VIDEO',
      reason: 'illegal_content', sourceStoragePath: sourcePath,
      status: 'PENDING', attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
    }),
    report.set({
      status: 'resolved', moderationAction: 'REMOVE',
      targetType: 'video', targetOwnerUid: ownerUid, targetId: mediaId,
      evidencePreservationStatus: 'PENDING',
    }),
  ]);

  await assert.rejects(preserveModerationEvidence(reportId), /origem não encontrado/);
  assert.equal((await job.get()).get('status'), 'PENDING');
  assert.equal((await report.get()).get('evidencePreservationStatus'), 'PENDING');
  assert.equal((await evidence.get()).exists, false);
  assert.equal((await evidenceFile.exists())[0], false);

  await sourceFile.save(bytes, { contentType: 'video/mp4' });
  await preserveModerationEvidence(reportId);
  assert.equal((await report.get()).get('evidencePreservationStatus'), 'PRESERVED');
  assert.equal((await job.get()).exists, false);
  assert.equal((await evidence.get()).get('storagePath'), evidencePath);
  assert.deepEqual((await evidenceFile.download())[0], bytes);

  await preserveModerationEvidence(reportId);
  assert.deepEqual((await evidenceFile.download())[0], bytes);
  console.log('✔ recuperação após origem ausente preservou bytes e foi idempotente');
} finally {
  await Promise.allSettled([
    job.delete(), report.delete(), evidence.delete(),
    sourceFile.delete({ ignoreNotFound: true }),
    evidenceFile.delete({ ignoreNotFound: true }),
  ]);
  await deleteApp(app);
}
