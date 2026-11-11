// Tests planned STRICT Rules without deploying them or editing firestore.rules.
// Runs inside the existing demo emulators only.
import assert from 'node:assert/strict';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { buildRegistrationLockdownCandidate } from '../maintenance/build-registration-lockdown-candidate.mjs';

const PROJECT = 'demo-entretenimento-lockdown';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');

const rules = buildRegistrationLockdownCandidate();
for (const expected of [
  'return false && isSelf(userId)',
  'allow create: if false && resource == null',
  'allow create: if isEmailDoc() && common()',
  'allow get: if false && isNicknameDoc()',
]) {
  assert.ok(rules.includes(expected), 'Missing lockdown guard: ' + expected);
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT, firestore: { host: '127.0.0.1', port: 18080, rules },
});
const UID = 'lockdown-owner';
try {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', UID), {
      uid: UID, nickname: 'Perfil Fixo', profileCompleted: false,
      accountStatus: 'active', emailVerified: true,
      publicVisibility: 'hidden', interactionBlocked: true,
      acceptedTerms: {
        accepted: true, version: 'v3', acknowledgedPrivacyNotice: true,
      },
    });
  });
  const db = testEnv.authenticatedContext(UID, { email_verified: true }).firestore();
  const owner = doc(db, 'users', UID);

  await assertFails(updateDoc(owner, {
    gender: 'mulher', declaredIdentityCode: 'mulher', identityCatalogVersion: 1,
    orientation: 'heterossexual', estado: 'RJ', municipio: 'Rio de Janeiro',
    profileCompleted: true, publicVisibility: 'visible',
    interactionBlocked: false, registrationCompletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(), updatedAtMs: Date.now(),
  }));
  await assertFails(setDoc(doc(db, 'public_profiles', UID), {
    uid: UID, nickname: 'Perfil Fixo', nicknameNormalized: 'perfil_fixo',
    role: 'free', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(db, 'public_index', 'nickname:perfil_fixo')));
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(),
    'public_index', 'nickname:perfil_fixo')));
  await assertFails(setDoc(doc(db, 'public_index', 'nickname:perfil_fixo'), {
    uid: UID, type: 'nickname', value: 'perfil_fixo',
    createdAt: serverTimestamp(), lastChangedAt: serverTimestamp(),
  }));

  const batch = writeBatch(db);
  batch.update(owner, {
    gender: 'mulher', declaredIdentityCode: 'mulher', identityCatalogVersion: 1,
    profileCompleted: true, publicVisibility: 'visible',
    interactionBlocked: false, registrationCompletedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'public_profiles', UID), {
    uid: UID, nickname: 'Perfil Fixo', role: 'free',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await assertFails(batch.commit());
  console.log('[lockdown:candidate] PASS direct and atomic legacy registration denied');

  await assertSucceeds(updateDoc(owner, { descricao: 'Descrição legítima' }));
  assert.equal((await getDoc(owner)).data().descricao, 'Descrição legítima');
  await assertFails(getDoc(doc(db, 'nickname_reservations', 'perfil_fixo')));
  console.log('[lockdown:candidate] PASS ordinary profile edits, private reservation');
} finally {
  await testEnv.cleanup();
}
