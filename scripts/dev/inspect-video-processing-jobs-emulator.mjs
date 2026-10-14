// Read-only audit of video processing jobs in the Firestore Emulator.
// Requires explicit localhost FIRESTORE_EMULATOR_HOST. Never writes documents,
// imports emulator snapshots, exports private fields, or calls Cloud services.
//
// PowerShell:
//   $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
//   $env:FIREBASE_PROJECT_ID = 'entretenimento-sexual'
//   node scripts/dev/inspect-video-processing-jobs-emulator.mjs
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import {
  addVideoProcessingJobToInventory,
  createVideoProcessingInventory,
} from './video-processing-job-inventory.policy.mjs';

const host = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
const matched = /^(?:127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(host);
const port = matched ? Number(matched[1]) : 0;
if (!matched || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
  console.error('[video:inventory] FIRESTORE_EMULATOR_HOST precisa ser localhost:porta.');
  process.exit(1);
}

const projectId = String(process.env.FIREBASE_PROJECT_ID ?? '').trim();
if (projectId !== 'entretenimento-sexual' && !/^demo-[a-z0-9-]{1,60}$/.test(projectId)) {
  console.error('[video:inventory] FIREBASE_PROJECT_ID ausente ou não autorizado.');
  process.exit(1);
}

function boundedInt(value, fallback, min, max, name) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(name + ' deve estar entre ' + min + ' e ' + max + '.');
  }
  return n;
}

const pageSize = boundedInt(
  process.env.VIDEO_PROCESSING_INVENTORY_PAGE_SIZE, 50, 1, 200,
  'VIDEO_PROCESSING_INVENTORY_PAGE_SIZE'
);
const maxDocuments = boundedInt(
  process.env.VIDEO_PROCESSING_INVENTORY_MAX_DOCUMENTS, 5000, 1, 20000,
  'VIDEO_PROCESSING_INVENTORY_MAX_DOCUMENTS'
);

// Emulator routing is mandatory; initialize only after validating the host.
const app = initializeApp({ projectId }, 'video-processing-readonly-inventory');
const db = getFirestore(app);
const inventory = createVideoProcessingInventory();
let pages = 0;
let cursor = null;
let hasMore = false;

try {
  while (inventory.scanned < maxDocuments) {
    const limit = Math.min(pageSize, maxDocuments - inventory.scanned);
    let query = db.collection('media_video_processing_jobs')
      .orderBy(FieldPath.documentId()).limit(limit);
    if (cursor) query = query.startAfter(cursor);

    const batch = await query.get();
    if (batch.empty) break;
    pages += 1;
    const now = Date.now();
    for (const doc of batch.docs) {
      addVideoProcessingJobToInventory(inventory, doc.data(), now);
    }
    cursor = batch.docs.at(-1);
    if (batch.size < limit) break;
  }

  if (inventory.scanned >= maxDocuments && cursor) {
    hasMore = !(await db.collection('media_video_processing_jobs')
      .orderBy(FieldPath.documentId()).startAfter(cursor).limit(1).get()).empty;
  }

  console.log('[video:inventory] Somente leitura — resumo agregado.', {
    projectId, emulatorHost: host, pages, maxDocuments,
    truncated: hasMore, ...inventory,
  });
  console.log('[video:inventory] Nenhum documento foi modificado.');
  if (inventory.cancellationScheduling.overdue24h > 0) {
    console.warn(
      '[video:inventory] Cancelamentos antigos não comprovam falha: ' +
      'o Firestore Emulator não executa automaticamente um scheduler cloud. ' +
      'As categorias abaixo são apenas evidências persistidas, ' +
      'não consultas em tempo real ao Transcoder.'
    );
  }
  if (hasMore) {
    console.warn('[video:inventory] Contagem parcial: aumente o limite para inspecionar mais registros.');
  }
} finally {
  await deleteApp(app);
}
