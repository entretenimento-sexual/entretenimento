/**
 * Auditoria read-only de fotos legadas, EXCLUSIVAMENTE no Emulator Suite.
 * Sem exclusão, escrita, export de IDs, leitura de conteúdo ou correção.
 *
 * Ex.: node scripts/dev/audit-legacy-photo-origins.mjs --max=150
 */
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const HOST = '127.0.0.1';
const projectId = 'entretenimento-sexual';
const maxArg = process.argv.find((s) => s.startsWith('--max='));
const max = Number(maxArg?.slice(6) ?? 150);
if (!Number.isSafeInteger(max) || max < 1 || max > 500) {
  throw new Error('--max deve ficar entre 1 e 500.');
}
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? `${HOST}:8080`;
const storageHost = process.env.STORAGE_EMULATOR_HOST ??
  `http://${HOST}:9199`;
if (!['127.0.0.1:8080', 'localhost:8080'].includes(firestoreHost) ||
    !['http://127.0.0.1:9199', 'http://localhost:9199'].includes(storageHost) ||
    process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId ||
    process.env.GCP_PROJECT && process.env.GCP_PROJECT !== projectId) {
  throw new Error('Somente emuladores locais do projeto entretenimento-sexual.');
}
process.env.GCLOUD_PROJECT = projectId;
process.env.GCP_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
process.env.STORAGE_EMULATOR_HOST = storageHost;

const app = initializeApp({
  projectId,
  storageBucket: `${projectId}.appspot.com`,
}, 'audit-legacy-photo-origins');
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

async function exists(path) {
  if (typeof path !== 'string' || !path) return false;
  const [ok] = await bucket.file(path).exists();
  return ok;
}
const counts = {
  total: 0,
  publishedFinalConfirmed: 0,
  publishedSourceAlreadyMissing: 0,
  publishedFinalMissing: 0,
  publishedNeedsReview: 0,
  unpublished: 0,
  noSourcePath: 0,
};
try {
  const snapshot = await db.collectionGroup('photos').limit(max).get();
  for (const document of snapshot.docs) {
    const segments = document.ref.path.split('/');
    if (segments.length !== 4 || segments[0] !== 'users' ||
        segments[2] !== 'photos') continue;
    const ownerUid = segments[1];
    const photoId = segments[3];
    counts.total += 1;
    const privateData = document.data();
    const privatePath = String(privateData.path ?? '');
    const ownedPrivatePath = privatePath.startsWith(
      `users/${ownerUid}/uploads/images/`
    ) && privatePath.slice(`users/${ownerUid}/uploads/images/`.length)
      .length > 0 && !privatePath.slice(
        `users/${ownerUid}/uploads/images/`.length
      ).includes('/');
    if (!ownedPrivatePath) {
      counts.noSourcePath += 1;
      continue;
    }

    const pub = await db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    ).get();
    if (!pub.exists || pub.get('isPublished') !== true) {
      counts.unpublished += 1;
      continue;
    }
    const finalPath = pub.get('publishedStoragePath');
    const finalPrefix = `users/${ownerUid}/published/images/${photoId}/`;
    const validFinal = typeof finalPath === 'string' &&
      finalPath.startsWith(finalPrefix) &&
      finalPath.slice(finalPrefix.length).length > 0 &&
      !finalPath.slice(finalPrefix.length).includes('/');
    if (!validFinal) {
      counts.publishedNeedsReview += 1;
      continue;
    }
    if (!await exists(finalPath)) {
      counts.publishedFinalMissing += 1;
      continue;
    }
    if (await exists(privatePath)) {
      counts.publishedFinalConfirmed += 1;
    } else {
      counts.publishedSourceAlreadyMissing += 1;
    }
  }
  console.log('[legacy-photo-origin-audit] SOMENTE LEITURA / NÃO EXCLUIR');
  console.log(JSON.stringify({
    ...counts, scanLimit: max, truncated: snapshot.size === max,
  }, null, 2));
} finally {
  await deleteApp(app);
}
