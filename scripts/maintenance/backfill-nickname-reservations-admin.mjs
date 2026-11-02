// Reconciliação de reservas existentes: SOMENTE Admin SDK.
// Dry-run é o padrão. Nunca escreve em users, public_profiles ou public_index.
// Aplicação requer projeto explícito e dupla confirmação; nenhum deploy.
import { createRequire } from 'node:module';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { classifyNicknameBackfill } from './nickname-reservation-backfill.policy.mjs';

const require = createRequire(import.meta.url);
const projectId = String(process.env.FIREBASE_PROJECT_ID ?? '').trim();
const dryRun = process.env.NICKNAME_RESERVATION_DRY_RUN !== 'false';
const applyApproved = process.env.NICKNAME_RESERVATION_APPLY === 'true';
const confirmedProject = String(process.env.NICKNAME_RESERVATION_CONFIRM_PROJECT ?? '').trim();
const pageSize = Math.min(200, Math.max(1,
  Number.parseInt(process.env.NICKNAME_RESERVATION_PAGE_SIZE ?? '100', 10) || 100));
const maxRecords = Math.min(100_000, Math.max(1,
  Number.parseInt(process.env.NICKNAME_RESERVATION_MAX_RECORDS ?? '1000', 10) || 1000));

if (!/^[a-z0-9][a-z0-9-]{3,62}$/.test(projectId)) {
  throw new Error('FIREBASE_PROJECT_ID explícito é obrigatório.');
}
if (!dryRun && (!applyApproved || confirmedProject !== projectId)) {
  throw new Error('Aplicação negada: confirme APPLY=true e o ID exato do projeto.');
}

// Usa a normalização já implantada no backend; nunca duplicar algoritmo.
let normalizeRegistrationNickname;
try {
  ({ normalizeRegistrationNickname } = require(
    '../../functions/lib/registration/nickname-reservation.policy.js'
  ));
} catch {
  throw new Error('Execute npm --prefix functions run build antes do backfill.');
}
if (typeof normalizeRegistrationNickname !== 'function') {
  throw new Error('Normalização canônica do backend indisponível.');
}

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId });
}
const db = getFirestore();
const stats = {
  scanned: 0, candidate: 0, already: 0, invalid: 0, conflict: 0,
  applied: 0, changedDuringTransaction: 0,
};

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

    const userRef = db.collection('users').doc(uid);
    const reservationRef = db.collection('nickname_reservations').doc(key);
    const [userSnap, reservationSnap] = await Promise.all([
      userRef.get(), reservationRef.get(),
    ]);
    const decision = classifyNicknameBackfill({
      indexId: indexDoc.id,
      indexData: raw,
      userData: userSnap.exists ? userSnap.data() : null,
      reservationData: reservationSnap.exists ? reservationSnap.data() : null,
      normalizeNickname: normalizeRegistrationNickname,
    });
    stats[decision] += 1;
    if (decision !== 'candidate' || dryRun) continue;

    // Revalidar index, titular e reserva sob a mesma transação: nunca
    // converter uma chave que mudou de dono enquanto o script a lia.
    const outcome = await db.runTransaction(async (tx) => {
      const [currentIndex, currentUser, currentReservation] = await Promise.all([
        tx.get(indexDoc.ref),
        tx.get(userRef),
        tx.get(reservationRef),
      ]);
      const current = classifyNicknameBackfill({
        indexId: indexDoc.id,
        indexData: currentIndex.exists ? currentIndex.data() : null,
        userData: currentUser.exists ? currentUser.data() : null,
        reservationData: currentReservation.exists ? currentReservation.data() : null,
        normalizeNickname: normalizeRegistrationNickname,
      });
      if (current !== 'candidate') return current;
      tx.create(reservationRef, {
        uid, key, state: 'RESERVED', policyVersion: 1,
        reservedAt: FieldValue.serverTimestamp(),
        migrationSource: 'legacy-public-index',
      });
      return 'applied';
    });
    if (outcome === 'applied') stats.applied += 1;
    else stats.changedDuringTransaction += 1;
  }
}
console.log('[nickname-reservation-backfill] final', {
  projectId, mode: dryRun ? 'DRY_RUN' : 'APPLY',
  maxRecords, ...stats,
  truncated: stats.scanned >= maxRecords,
});
if (stats.conflict || stats.invalid || stats.changedDuringTransaction) {
  console.warn(
    '[nickname-reservation-backfill] Inconsistências requerem auditoria manual. ' +
    'Nenhuma chave conflitante foi reassociada ou apagada.'
  );
}
