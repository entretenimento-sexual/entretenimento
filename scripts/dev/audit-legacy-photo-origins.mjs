/**
 * Diagnóstico amostral SOMENTE LEITURA de originais legados no Emulator Suite.
 * Nenhum estado desta auditoria autoriza exclusão; não imprime caminhos ou IDs.
 * Não consulta nem exporta bytes. Não faz escrita, reparo, nem limpeza.
 *
 * Ex.: node scripts/dev/audit-legacy-photo-origins.mjs --max=150
 */
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  classifyLegacyPhotoCleanupReadiness,
  LEGACY_ORIGIN_BLOCKERS,
} from './photo-legacy-cleanup-readiness.policy.mjs';

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

function ownedOriginalPath(ownerUid, value) {
  const prefix = `users/${ownerUid}/uploads/images/`;
  return typeof value === 'string' && value.startsWith(prefix) &&
    value.slice(prefix.length).length > 0 &&
    !value.slice(prefix.length).includes('/');
}

function ownedFinalPath(ownerUid, photoId, value) {
  const prefix = `users/${ownerUid}/published/images/${photoId}/`;
  return typeof value === 'string' && value.startsWith(prefix) &&
    value.slice(prefix.length).length > 0 &&
    !value.slice(prefix.length).includes('/');
}

const app = initializeApp({
  projectId,
  storageBucket: `${projectId}.appspot.com`,
}, 'audit-legacy-photo-origins');
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

async function objectMetadata(path) {
  try {
    const [metadata] = await bucket.file(path).getMetadata();
    return {
      exists: true,
      generation: typeof metadata.generation === 'string'
        ? metadata.generation : String(metadata.generation ?? ''),
    };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? error.code : null;
    if (code === 404 || code === '404') {
      return { exists: false, generation: null };
    }
    // Falha de leitura NÃO equivale a arquivo ausente.
    throw error;
  }
}

const counts = Object.fromEntries(
  LEGACY_ORIGIN_BLOCKERS.map((state) => [state, 0])
);
let scanned = 0;
try {
  const snapshot = await db.collectionGroup('photos').limit(max).get();
  for (const document of snapshot.docs) {
    const segments = document.ref.path.split('/');
    if (segments.length !== 4 || segments[0] !== 'users' ||
        segments[2] !== 'photos') continue;

    const ownerUid = segments[1];
    const photoId = segments[3];
    const privateData = document.data();
    scanned += 1;
    const originalPath = ownedOriginalPath(ownerUid, privateData.path)
      ? privateData.path
      : ownedOriginalPath(ownerUid, privateData.url)
        ? privateData.url : null;

    if (!originalPath) {
      counts.invalid_identity_or_source += 1;
      continue;
    }

    const publicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const projectionRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const deletionJobRef = db.doc(
      `media_photo_deletion_jobs/${ownerUid}_${photoId}`
    );
    const [pub, projection, deletionJob] = await Promise.all([
      publicationRef.get(), projectionRef.get(), deletionJobRef.get(),
    ]);
    const publication = pub.exists ? pub.data() : null;
    const finalPath = publication?.publishedStoragePath;
    const original = await objectMetadata(originalPath);
    const final = publication && ownedFinalPath(ownerUid, photoId, finalPath)
      ? await objectMetadata(finalPath)
      : { exists: false, generation: null };

    const state = classifyLegacyPhotoCleanupReadiness({
      ownerUid, photoId, originalPath, original, final, publication,
      projection: projection.exists ? projection.data() : null,
      deletionJob: deletionJob.exists,
      privateDocument: privateData,
    });
    counts[state] += 1;
  }
  console.log('[legacy-photo-origin-audit] SOMENTE LEITURA / NÃO EXCLUIR');
  console.log(JSON.stringify({
    scanned,
    scanLimit: max,
    truncated: snapshot.size === max,
    statuses: counts,
    deletionAuthorized: false,
    remainingBlockers: [
      'consumidores legados não migrados',
      'reservas e processamento pendentes não reconciliados',
      'retenção legal e evidências não auditadas',
      'revalidação transacional e generation fence não implementados',
    ],
  }, null, 2));
} finally {
  await deleteApp(app);
}
