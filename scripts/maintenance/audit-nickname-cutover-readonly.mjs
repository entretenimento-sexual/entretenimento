// COMPLETELY READ-ONLY. No Firestore writes and no raw PII in output.
// Complements index-first backfill to detect owners whose indexes are absent.
import { createRequire } from 'node:module';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import {
  classifyNicknameCutoverRecord, createNicknameCutoverSummary,
  accumulateNicknameCutover, evaluateNicknameCutoverGate,
} from './nickname-cutover-inventory.policy.mjs';

const require = createRequire(import.meta.url);
const projectId = String(process.env.FIREBASE_PROJECT_ID ?? '').trim();
if (!/^[a-z0-9][a-z0-9-]{3,62}$/.test(projectId)) {
  throw new Error('Informe FIREBASE_PROJECT_ID explicitamente.');
}
if (process.env.NICKNAME_CUTOVER_APPLY === 'true' ||
    process.env.NICKNAME_RESERVATION_APPLY === 'true') {
  throw new Error('Esta ferramenta é exclusivamente de leitura.');
}
const maximum = Number.parseInt(process.env.NICKNAME_AUDIT_MAX_USERS ?? '1000', 10);
if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 50000) {
  throw new Error('NICKNAME_AUDIT_MAX_USERS deve estar entre 1 e 50000.');
}
let normalizeRegistrationNickname;
try {
  ({ normalizeRegistrationNickname } = require(
    '../../functions/lib/registration/nickname-reservation.policy.js'
  ));
} catch {
  throw new Error('Compile Functions antes de auditar: npm run functions:build.');
}
if (typeof normalizeRegistrationNickname !== 'function') {
  throw new Error('Normalizador canônico indisponível.');
}
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId }));
const summary = createNicknameCutoverSummary();
let cursor = null;

while (summary.scannedUsers < maximum) {
  let query = db.collection('users').orderBy(FieldPath.documentId())
    .limit(Math.min(50, maximum - summary.scannedUsers));
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;
  cursor = page.docs.at(-1);

  for (const record of page.docs) {
    const user = record.data();
    if (user.profileCompleted !== true) {
      accumulateNicknameCutover(summary, { category: 'INCOMPLETE', flags: [] });
      continue;
    }
    const normalized = normalizeRegistrationNickname(user.nickname);
    if (!normalized) {
      accumulateNicknameCutover(summary, classifyNicknameCutoverRecord({
        uid: record.id, user, publicProfile: null, index: null,
        reservation: null, normalizeNickname: normalizeRegistrationNickname,
      }));
      continue;
    }
    const refs = [
      db.collection('public_profiles').doc(record.id),
      db.collection('public_index').doc('nickname:' + normalized.key),
      db.collection('nickname_reservations').doc(normalized.key),
    ];
    const snapshots = await db.getAll(...refs);
    const decision = classifyNicknameCutoverRecord({
      uid: record.id, user,
      publicProfile: snapshots[0].exists ? snapshots[0].data() : null,
      index: snapshots[1].exists ? snapshots[1].data() : null,
      reservation: snapshots[2].exists ? snapshots[2].data() : null,
      normalizeNickname: normalizeRegistrationNickname,
    });
    accumulateNicknameCutover(summary, decision);
  }
}
const truncated = summary.scannedUsers >= maximum;
const gate = evaluateNicknameCutoverGate(summary, { truncated });
console.log('[nickname-cutover-readonly] summary', JSON.stringify({
  projectId, mode: 'READ_ONLY', maxUsers: maximum, truncated,
  ...summary, ...gate,
}, null, 2));
console.log('[nickname-cutover-readonly] Also check index-first orphan coverage in dry-run.');
console.log('[nickname-cutover-readonly] InventoryClean alone DOES NOT authorize Rules deploy.');
