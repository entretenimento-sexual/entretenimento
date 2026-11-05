import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const reader = fileURLToPath(new URL(
  '../../functions/src/discovery/legacy-recovery-admin-readonly.firestore.ts',
  import.meta.url
));
const index = fileURLToPath(new URL(
  '../../functions/src/index.ts', import.meta.url
));
const source = readFileSync(reader, 'utf8');
const executable = source.split('\n')
  .filter(x => !x.trim().startsWith('//') &&
    !x.trim().startsWith('*')).join('\n');

test('B2.7 reads verified Firebase Auth and current staff documents', () => {
  assert.match(source, /import type \{ Auth \} from 'firebase-admin\/auth'/);
  assert.match(source, /import type \{ Firestore \} from 'firebase-admin\/firestore'/);
  assert.match(source, /verifyIdToken\(/);
  assert.match(source, /request\.operatorIdToken, true/);
  assert.match(source, /backend\.auth\.getUser\(verified\.uid\)/);
  assert.match(source, /collection\('users'\)/);
  assert.match(source, /currentAdmin\(/);
  assert.match(source, /LEGACY_RECOVERY_APPROVAL_COLLECTION/);
  assert.match(source, /'APPROVED_FOR_REVIEW_ONLY'/);
  assert.match(source, /approvedByUid/);
  assert.match(source, /reviewerUid === verified\.uid/);
});

test('read-only module stays internal, emulator-scoped, without write path', () => {
  const exports = readFileSync(index, 'utf8');
  assert.equal(exports.includes('legacy-recovery-admin-readonly.firestore'), false);
  assert.equal(exports.includes('inspectLegacyRecoveryAdminReadOnly'), false);
  for (const forbidden of [
    'onCall(', 'onRequest(', 'onSchedule(', 'initializeApp(',
    'getAuth(', 'getFirestore(', 'setDoc(', 'updateDoc(',
    'writeBatch(', 'runTransaction(', '.create(', '.set(', '.update(',
    '.delete(', 'tx.set(', 'tx.update(', 'tx.delete(',
    'console.log(', 'console.error(', 'process.exit(',
  ]) assert.equal(executable.includes(forbidden), false, forbidden);
  assert.match(source, /FIRESTORE_EMULATOR_HOST/);
  assert.match(source, /FIREBASE_AUTH_EMULATOR_HOST/);
  assert.match(source, /LEGACY_RECOVERY_READONLY_PROJECT/);
  assert.match(source, /persistentWritesAllowed: false/);
  assert.match(source, /privateRecoveryRead: false/);
  assert.match(source, /privateRecoveryWritten: false/);
});

test('strict orphan check recognizes only this non-deployable B2.7 module', () => {
  const checker = readFileSync(fileURLToPath(new URL(
    '../quality/check-production-orphans.mjs', import.meta.url
  )), 'utf8');
  const sourcePath = 'discovery/legacy-recovery-admin-readonly.firestore.ts';
  const declaration = [
    "posix(path.join(",
    "    functionsSourceRoot,",
    "    '" + sourcePath + "'",
    "  )),",
  ].join('\n');
  // Git checkout may produce CRLF on Windows. Normalize line endings
  // without widening the exact allowlisted file path.
  assert.equal(checker.replace(/\r\n/g, '\n').includes(declaration), true);
  assert.match(checker, /const functionOrphans = functionsProductionTs/);
  assert.match(checker, /!functionsOperationalArtifacts\.has\(filePath\)/);
  const exports = readFileSync(index, 'utf8');
  assert.equal(exports.includes('legacy-recovery-admin-readonly'), false);
  assert.equal(exports.includes('inspectLegacyRecoveryAdminReadOnly'), false);
});

test('read-only approval cannot be confused with production authority', () => {
  assert.match(source, /approvalRecordConsumed: false/);
  assert.match(source, /auditPersisted: false/);
  assert.match(source, /ownerConsentEstablished: false/);
  assert.match(source, /visibilityActivationAllowed: false/);
  assert.equal(source.includes('legacyRaw.interestedInGenders'), false);
});
