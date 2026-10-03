#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || !args.has('--apply');
const apply = args.has('--apply');

if (args.has('--dry-run') && apply) {
  console.error('[legacy-photo-review] Use apenas --dry-run ou --apply.');
  process.exit(2);
}

if (apply && process.env.PHOTO_LEGACY_REVIEW_RECONCILE_CONFIRM !== 'true') {
  console.error(
    '[legacy-photo-review] --apply exige PHOTO_LEGACY_REVIEW_RECONCILE_CONFIRM=true.'
  );
  process.exit(2);
}

const ownerArg = process.argv
  .slice(2)
  .find((value) => value.startsWith('--owner='));
const ownerUid = ownerArg ? ownerArg.slice('--owner='.length).trim() : '';

const projectId = 'entretenimento-sexual';
const hubUrl = 'http://127.0.0.1:4400/emulators';

async function requireEmulators() {
  let response;
  try {
    response = await fetch(hubUrl);
  } catch {
    console.error('[legacy-photo-review] Emulator Hub 4400 indisponível.');
    process.exit(3);
  }

  if (!response.ok) {
    console.error('[legacy-photo-review] Emulator Hub não respondeu com sucesso.');
    process.exit(3);
  }

  const body = await response.json();
  const names = new Set(Object.keys(body ?? {}));
  for (const required of ['firestore', 'functions']) {
    if (!names.has(required)) {
      console.error(`[legacy-photo-review] Emulator obrigatório ausente: ${required}`);
      process.exit(3);
    }
  }
}

await requireEmulators();

process.env.FIREBASE_PROJECT_ID = projectId;
process.env.GCLOUD_PROJECT = projectId;
process.env.GCP_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
process.env.FUNCTIONS_EMULATOR = 'true';

const [{ db }, migration] = await Promise.all([
  import('../../functions/lib/firebaseApp.js'),
  import('../../functions/lib/media/application/legacy-photo-preventive-review-migration.service.js'),
]);

const summary = {
  projectId,
  emulatorOnly: true,
  dryRun,
  ownerUid: ownerUid || null,
  scanned: 0,
  candidates: 0,
  normalized: 0,
  skipped: 0,
  failures: 0,
};

let query = db.collectionGroup('photo_publications');
const snapshots = await query.get();

for (const doc of snapshots.docs) {
  const parts = doc.ref.path.split('/');
  const candidateOwnerUid = parts[1] ?? '';
  const photoId = parts[3] ?? '';

  if (!candidateOwnerUid || !photoId) continue;
  if (ownerUid && candidateOwnerUid !== ownerUid) continue;

  summary.scanned += 1;
  const data = doc.data() ?? {};
  if (
    data.isPublished !== true ||
    String(data.moderationStatus ?? '').trim().toUpperCase() !== 'PENDING_REVIEW'
  ) {
    continue;
  }

  const reportId = String(data.preventiveReviewReportId ?? '').trim();
  if (!reportId) {
    summary.skipped += 1;
    continue;
  }

  const reportSnap = await db.collection('moderation_reports').doc(reportId).get();
  const report = reportSnap.exists ? reportSnap.data() ?? {} : null;
  const synthetic =
    !!report &&
    String(report.reporterUid ?? '').trim() === 'system' &&
    String(report.targetType ?? '').trim().toLowerCase() === 'photo' &&
    String(report.targetId ?? '').trim() === photoId &&
    String(report.targetOwnerUid ?? '').trim() === candidateOwnerUid &&
    String(report.reason ?? '').trim() === 'preventive_media_review' &&
    String(report.source ?? '').trim() === 'system' &&
    Number(data.reportsCount ?? 0) === 0 &&
    Number(data.confirmedReportsCount ?? 0) === 0;

  if (!synthetic) {
    summary.skipped += 1;
    continue;
  }

  summary.candidates += 1;
  console.log('[legacy-photo-review] revisão preventiva legada', {
    ownerUid: candidateOwnerUid,
    photoId,
    reportId,
    dryRun,
  });

  if (!apply) continue;

  try {
    const state = await migration.normalizeLegacyPhotoPreventiveReview(
      candidateOwnerUid,
      photoId
    );
    if (state === 'normalized') {
      summary.normalized += 1;
    } else {
      summary.skipped += 1;
    }
  } catch (error) {
    summary.failures += 1;
    console.error('[legacy-photo-review] falha', {
      ownerUid: candidateOwnerUid,
      photoId,
      error: error instanceof Error ? error.message : String(error ?? ''),
    });
  }
}

console.log('[legacy-photo-review] resumo', summary);

if (summary.failures > 0) process.exit(1);
