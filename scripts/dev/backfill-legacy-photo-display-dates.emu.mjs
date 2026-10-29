/**
 * Backfill pontual de displayDate, EXCLUSIVAMENTE no Firestore Emulator local.
 * Default: dry-run, sem mutações. O --apply também é restrito ao emulador e
 * exige --confirm-emulator-only. Não elimina documentos, arquivos ou evidências.
 *
 * node scripts/dev/backfill-legacy-photo-display-dates.emu.mjs --max=150
 * node scripts/dev/backfill-legacy-photo-display-dates.emu.mjs --max=150 --apply --confirm-emulator-only
 */
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { classifyLegacyPublishedPhotoDate } from
  './legacy-photo-display-date-backfill.policy.mjs';

const HOST = '127.0.0.1';
const projectId = 'entretenimento-sexual';
const maxArg = process.argv.find((v) => v.startsWith('--max='));
const max = Number(maxArg?.slice(6) ?? 150);
const apply = process.argv.includes('--apply');
if (!Number.isSafeInteger(max) || max < 1 || max > 500) {
  throw new Error('--max deve ficar entre 1 e 500.');
}
if (apply && !process.argv.includes('--confirm-emulator-only')) {
  throw new Error('O modo --apply exige --confirm-emulator-only.');
}
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? `${HOST}:8080`;
if (!['127.0.0.1:8080', 'localhost:8080'].includes(emulatorHost) ||
    (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) ||
    (process.env.GCP_PROJECT && process.env.GCP_PROJECT !== projectId)) {
  throw new Error('Backfill autorizado somente para o Firestore Emulator local.');
}
process.env.GCLOUD_PROJECT = projectId;
process.env.GCP_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;

const app = initializeApp({ projectId }, 'legacy-photo-date-backfill');
const db = getFirestore(app);
const stats = {
  scanned: 0,
  backfill_possible: 0,
  migrated: 0,
  invalid_legacy_record: 0,
  publication_missing_or_inactive: 0,
  deletion_in_progress: 0,
  moderation_protected: 0,
  invalid_final_publication_path: 0,
  already_canonical: 0,
  no_valid_legacy_date: 0,
  raced_or_changed: 0,
};
try {
  const snapshot = await db.collectionGroup('photos').limit(max).get();
  for (const privateSnap of snapshot.docs) {
    const parts = privateSnap.ref.path.split('/');
    if (parts.length !== 4 || parts[0] !== 'users' ||
        parts[2] !== 'photos') continue;
    const ownerUid = parts[1];
    const photoId = parts[3];
    stats.scanned++;
    const publicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const deletionRef = db.doc(
      `media_photo_deletion_jobs/${ownerUid}_${photoId}`
    );
    const [publicationSnap, deletionSnap] = await Promise.all([
      publicationRef.get(), deletionRef.get(),
    ]);
    const input = {
      ownerUid, photoId,
      privatePhoto: privateSnap.data(),
      publication: publicationSnap.exists ? publicationSnap.data() : null,
      deletionJob: deletionSnap.exists,
    };
    const classification = classifyLegacyPublishedPhotoDate(input);
    stats[classification]++;
    if (!apply || classification !== 'backfill_possible') continue;

    // A escrita é uma única transação; nunca sobrescreve data canônica.
    const migrated = await db.runTransaction(async (tx) => {
      const [freshPrivate, freshPublication, freshDeletion] = await Promise.all([
        tx.get(privateSnap.ref), tx.get(publicationRef), tx.get(deletionRef),
      ]);
      const freshInput = {
        ownerUid, photoId,
        privatePhoto: freshPrivate.exists ? freshPrivate.data() : null,
        publication: freshPublication.exists ? freshPublication.data() : null,
        deletionJob: freshDeletion.exists,
      };
      if (classifyLegacyPublishedPhotoDate(freshInput) !== 'backfill_possible') {
        return false;
      }
      tx.update(publicationRef, {
        displayDate: freshInput.privatePhoto.displayDate,
        displayDateUpdatedAt: Date.now(),
      });
      return true;
    });
    if (migrated) stats.migrated++;
    else stats.raced_or_changed++;
  }
  console.log('[photo-display-date-backfill] EMULADOR LOCAL / SEM STORAGE');
  console.log(JSON.stringify({
    ...stats, scanLimit: max, truncated: snapshot.size === max,
    mode: apply ? 'emulator-apply' : 'dry-run',
    productionChanged: false,
  }, null, 2));
} finally {
  await deleteApp(app);
}
