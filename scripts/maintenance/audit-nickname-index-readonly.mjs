// Inventário do índice público de apelidos. Somente leitura.
import { createRequire } from 'node:module';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { writeFileSync } from 'node:fs';
import { buildNicknameScanReport, shouldInspectNextDocument } from './nickname-scan-report.policy.mjs';
import { classifyNicknameIndex } from './nickname-index-inventory.policy.mjs';

const require = createRequire(import.meta.url);
const projectId = String(process.env.FIREBASE_PROJECT_ID ?? '').trim();
const pageSize = Math.min(200, Math.max(1,
  Number.parseInt(process.env.NICKNAME_INDEX_PAGE_SIZE ?? '100', 10) || 100));
const maxRecords = Math.min(100_000, Math.max(1,
  Number.parseInt(process.env.NICKNAME_INDEX_MAX_RECORDS ?? '1000', 10) || 1000));

if (!/^[a-z0-9][a-z0-9-]{3,62}$/.test(projectId)) {
  throw new Error('FIREBASE_PROJECT_ID explícito é obrigatório.');
}

// Usa a normalização já implantada no backend; nunca duplicar algoritmo.
let resolveStoredRegistrationNickname;
try {
  ({ resolveStoredRegistrationNickname } = require(
    '../../functions/lib/registration/nickname-reservation.policy.js'
  ));
} catch {
  throw new Error('Execute npm --prefix functions run build antes do inventário.');
}
if (typeof resolveStoredRegistrationNickname !== 'function') {
  throw new Error('Normalização canônica do backend indisponível.');
}

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId });
}
const db = getFirestore();
// Campos históricos do relatório consumidos por nickname:cutover-readiness.
const stats = {
  scanned: 0, candidate: 0, already: 0, invalid: 0, conflict: 0,
  applied: 0, changedDuringTransaction: 0,
};
const auditStartedAt = new Date().toISOString();

let cursor = null;
while (stats.scanned < maxRecords) {
  const remaining = maxRecords - stats.scanned;
  let query = db.collection('public_index')
    .orderBy(FieldPath.documentId())
    .endAt('nickname:\uf8ff')
    .limit(Math.min(pageSize, remaining));
  query = cursor ? query.startAfter(cursor) : query.startAt('nickname:');
  const page = await query.get();
  if (page.empty) break;
  cursor = page.docs.at(-1);

  for (const indexDoc of page.docs) {
    stats.scanned += 1;
    const raw = indexDoc.data() ?? {};
    const uid = typeof raw.uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(raw.uid)
      ? raw.uid : null;
    const key = indexDoc.id.slice('nickname:'.length);
    if (!uid || !/^[a-z0-9._-]{3,40}$/.test(key)) {
      stats.invalid += 1;
      continue;
    }

    const userSnap = await db.collection('users').doc(uid).get();
    const decision = classifyNicknameIndex({
      indexId: indexDoc.id,
      indexData: raw,
      userData: userSnap.exists ? userSnap.data() : null,
      normalizeNickname: resolveStoredRegistrationNickname,
    });
    stats[decision] += 1;
  }
}
// Check one more document within the nickname prefix before reporting a
// complete scan. A full final page does not itself prove truncation.
const boundaryReached = stats.scanned >= maxRecords;
const nextDocumentExists = shouldInspectNextDocument({
  scanned: stats.scanned, limit: maxRecords,
}) ? !(await db.collection('public_index').orderBy(FieldPath.documentId())
  .startAfter(cursor).endAt('nickname:\uf8ff').limit(1).get()).empty : false;
const report = buildNicknameScanReport({
  projectId, mode: 'DRY_RUN',
  environment: process.env.FIRESTORE_EMULATOR_HOST ? 'EMULATOR' : 'LIVE',
  limit: maxRecords,
  truncated: boundaryReached && nextDocumentExists,
  startedAt: auditStartedAt, completedAt: new Date().toISOString(),
  counters: stats,
});
console.log('[nickname-index-readonly] report', JSON.stringify(report, null, 2));
const reportPath = String(process.env.NICKNAME_INDEX_REPORT_PATH ?? '').trim();
if (reportPath) {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
}
if (stats.conflict || stats.invalid) {
  console.warn(
    '[nickname-index-readonly] Inconsistências requerem auditoria manual.'
  );
}
