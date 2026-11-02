// Integration of real callable Auth/Firestore/Functions emulators. DEMO ONLY.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import {
  initializeApp as initializeAdminApp, deleteApp as deleteAdminApp,
  applicationDefault,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'demo-entretenimento-media-e2e';
const HOST = '127.0.0.1';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, HOST + ':18080');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, HOST + ':19099');
assert.equal(process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT, PROJECT);
process.env.GCLOUD_PROJECT = PROJECT;
process.env.GCP_PROJECT = PROJECT;

const token = randomUUID();
const apps = [];
function makeClient(label) {
  const app = initializeApp({
    apiKey: 'demo-api-key', authDomain: PROJECT + '.firebaseapp.com',
    projectId: PROJECT,
  }, label + '-' + token);
  const auth = getAuth(app);
  const functions = getFunctions(app, 'us-central1');
  connectAuthEmulator(auth, 'http://' + HOST + ':19099', { disableWarnings: true });
  connectFunctionsEmulator(functions, HOST, 15001);
  apps.push(app);
  return { auth, functions };
}
async function waitFor(label, check) {
  for (let i = 0; i < 120; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Emulator timeout: ' + label);
}
async function rejects(callable, payload, code) {
  let error;
  try { await callable(payload); } catch (failure) { error = failure; }
  assert.ok(error, 'Callable should reject ' + code);
  assert.equal(error.code, 'functions/' + code, String(error.message));
}
async function grantEligibility(db, adminAuth, uid) {
  const now = Date.now();
  await adminAuth.updateUser(uid, { emailVerified: true });
  await db.doc('users/' + uid).set({
    acceptedTerms: { accepted: true, version: 'v3', acknowledgedPrivacyNotice: true },
    adultConsent: { accepted: true, version: 'v1' },
  }, { merge: true });
  await db.doc('age_eligibility_records/' + uid).set({
    uid, status: 'VERIFIED_ADULT', policyVersion: 1,
    source: 'INITIAL_VERIFICATION', method: 'EXTERNAL_PROVIDER',
    verifiedAtMs: now - 1_000, expiresAtMs: null,
    updatedAtMs: now,
  });
}
async function run() {
  const owner = makeClient('owner');
  const other = makeClient('other');
  const guest = makeClient('guest');
  const admin = initializeAdminApp({
    credential: applicationDefault(), projectId: PROJECT,
  }, 'admin-' + token);
  const db = getFirestore(admin);
  const adminAuth = getAdminAuth(admin);
  try {
    const [a,b] = await Promise.all([
      createUserWithEmailAndPassword(owner.auth, 'owner-' + token + '@example.test', 'Owner-2026-Aa1!'),
      createUserWithEmailAndPassword(other.auth, 'other-' + token + '@example.test', 'Other-2026-Aa1!'),
    ]);
    const uid = a.user.uid, otherUid = b.user.uid;
    const privateRef = db.doc('users/' + uid), otherRef = db.doc('users/' + otherUid);
    await waitFor('Auth user seeds', async () =>
      (await Promise.all([privateRef.get(), otherRef.get()])).every(s => s.exists)
    );
    const reserve = httpsCallable(owner.functions, 'reserveRegistrationNickname');
    const reserveOther = httpsCallable(other.functions, 'reserveRegistrationNickname');
    const complete = httpsCallable(owner.functions, 'completeRegistrationProfile');
    const completeOther = httpsCallable(other.functions, 'completeRegistrationProfile');
    const guestReserve = httpsCallable(guest.functions, 'reserveRegistrationNickname');
    await rejects(guestReserve, { nickname: 'Perfil Original' }, 'unauthenticated');
    assert.deepEqual((await reserve({ nickname: 'Perfil Original' })).data,
      { nickname: 'Perfil Original', normalized: 'perfil_original' });
    assert.equal((await db.doc('nickname_reservations/perfil_original').get()).get('uid'), uid);
    assert.equal((await db.doc('public_index/nickname:perfil_original').get()).get('uid'), uid);
    assert.equal((await db.doc('public_profiles/' + uid).get()).exists, false);
    console.log('[registration:e2e] PASS private reservation and no public profile');

    await rejects(reserveOther, { nickname: 'perfil_original' }, 'already-exists');
    assert.equal((await otherRef.get()).get('nickname'), '');
    await rejects(reserve, { nickname: 'Outro Apelido' }, 'failed-precondition');
    assert.equal((await db.doc('nickname_reservations/outro_apelido').get()).exists, false);
    assert.equal((await reserve({ nickname: 'Perfil Original' })).data.normalized, 'perfil_original');
    console.log('[registration:e2e] PASS ownership, collision and idempotence');

    const payload = {
      nickname: 'Perfil Original', gender: 'homem',
      orientation: 'heterossexual', estado: 'RJ', municipio: 'Rio de Janeiro',
    };
    await rejects(complete, payload, 'failed-precondition');
    assert.equal((await db.doc('public_profiles/' + uid).get()).exists, false);
    await adminAuth.updateUser(uid, { emailVerified: true });
    await rejects(complete, payload, 'failed-precondition');
    await privateRef.set({
      acceptedTerms: { accepted: true, version: 'v3', acknowledgedPrivacyNotice: true },
      adultConsent: { accepted: true, version: 'v1' },
    }, { merge: true });
    await rejects(complete, payload, 'permission-denied');
    assert.equal((await privateRef.get()).get('profileCompleted'), false);
    await grantEligibility(db, adminAuth, uid);
    assert.equal((await complete(payload)).data.status, 'COMPLETED');
    const publicRef = db.doc('public_profiles/' + uid);
    assert.equal((await privateRef.get()).get('profileCompleted'), true);
    assert.equal((await publicRef.get()).get('nicknameNormalized'), 'perfil_original');
    assert.equal((await complete(payload)).data.status, 'COMPLETED');
    await rejects(complete({ ...payload, nickname: 'Perfil Alterado' }), 'failed-precondition');
    assert.equal((await db.doc('public_index/nickname:perfil_original').get()).get('uid'), uid);
    console.log('[registration:e2e] PASS eligibility, completion, repeat and immutable nickname');

    await grantEligibility(db, adminAuth, otherUid);
    await rejects(completeOther(payload), 'already-exists');
    assert.equal((await otherRef.get()).get('profileCompleted'), false);
    assert.equal((await db.doc('public_profiles/' + otherUid).get()).exists, false);
    console.log('[registration:e2e] PASS second owner cannot claim completed nickname');
  } finally {
    await Promise.allSettled(apps.map(deleteApp));
    await deleteAdminApp(admin);
  }
}
run().catch(e => { console.error('[registration:e2e] FAIL:', e); process.exitCode = 1; });
