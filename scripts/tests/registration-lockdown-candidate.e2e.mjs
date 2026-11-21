import { readFileSync } from 'node:fs';
// Tests planned STRICT Rules without deploying them or editing firestore.rules.
// Runs inside the existing demo emulators only.
import assert from 'node:assert/strict';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';

const PROJECT = 'demo-entretenimento-lockdown';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

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

  const direct = testEnv.authenticatedContext('lockdown-seed', {
    email: 'seed@example.test', email_verified: false,
  }).firestore();
  await assertFails(setDoc(doc(direct, 'users', 'lockdown-seed'), {
    uid: 'lockdown-seed', email: 'seed@example.test', nickname: 'Perfil Pendente',
    role: 'free', tier: 'free', emailVerified: false, isSubscriber: false, subscriptionStatus: 'inactive',
    profileCompleted: false, publicVisibility: 'hidden', interactionBlocked: true, loginAllowed: true,
    accountStatus: 'active', registrationFlowVersion: 'v3-private-by-default', registrationCompletedAt: null,
    acceptedTerms: { accepted: false, date: serverTimestamp() },
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), registrationDate: serverTimestamp(),
    firstLogin: serverTimestamp(), nicknameHistory: [],
  }));

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
  console.log('[registration-rules:e2e] PASS direct and atomic legacy registration denied');

  await assertSucceeds(updateDoc(owner, { descricao: 'Descrição legítima' }));
  assert.equal((await getDoc(owner)).data().descricao, 'Descrição legítima');
  await assertFails(getDoc(doc(db, 'nickname_reservations', 'perfil_fixo')));
  console.log('[registration-rules:e2e] PASS ordinary profile edits, private reservation');
} finally {
  await testEnv.cleanup();
}
