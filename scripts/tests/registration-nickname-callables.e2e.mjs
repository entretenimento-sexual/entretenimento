// Integration of real callable Auth/Firestore/Functions emulators. DEMO ONLY.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword,
} from 'firebase/auth';
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
  return error;
}
async function grantEligibility(db, adminAuth, uid) {
  const now = Date.now();
  await adminAuth.updateUser(uid, { emailVerified: true });
  await db.doc('users/' + uid).set({
    acceptedTerms: { accepted: true, version: 'v3', acknowledgedPrivacyNotice: true },
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
    const recover = httpsCallable(owner.functions, 'recoverRegistrationSeed');
    const acceptTerms = httpsCallable(owner.functions, 'acceptPlatformTerms');
    const reserveOther = httpsCallable(other.functions, 'reserveRegistrationNickname');
    const complete = httpsCallable(owner.functions, 'completeRegistrationProfile');
    const completeOther = httpsCallable(other.functions, 'completeRegistrationProfile');
    const guestReserve = httpsCallable(guest.functions, 'reserveRegistrationNickname');
    const checkAvailability = httpsCallable(guest.functions,
      'getRegistrationNicknameAvailability');
    const nicknameStatus = async nickname =>
      (await checkAvailability({ nickname })).data;
    await rejects(guestReserve, { nickname: 'Perfil Original' }, 'unauthenticated');
    assert.deepEqual(await nicknameStatus('Perfil Original'), { status: 'available' });
    const indexedWithoutProfile = db.doc('public_index/nickname:zapzap');
    await indexedWithoutProfile.set({
      uid: 'fixture-not-published', type: 'nickname', value: 'zapzap',
    });
    assert.deepEqual(await nicknameStatus('zapzap'), { status: 'taken' });
    await indexedWithoutProfile.delete();
    await rejects(reserve, { nickname: 'Perfil Original', expectedUid: otherUid }, 'permission-denied');
    await rejects(recover, { expectedUid: otherUid }, 'permission-denied');
    await rejects(acceptTerms, {
      expectedUid: otherUid, acceptedTerms: true, acknowledgedPrivacyNotice: true,
    }, 'permission-denied');
    assert.equal((await privateRef.get()).get('acceptedTerms.accepted'), false);
    assert.equal((await db.doc('nickname_reservations/perfil').get()).exists, false);
    assert.deepEqual((await reserve({ nickname: 'Perfil Original', expectedUid: uid })).data,
      { nickname: 'Perfil Original', normalized: 'perfil' });
    assert.equal((await adminAuth.getUser(uid)).displayName, 'Perfil Original');
    assert.equal((await db.doc('nickname_reservations/perfil').get()).exists, false);
    assert.equal((await db.doc('public_index/nickname:perfil').get()).get('uid'), uid);
    assert.equal((await db.doc('public_profiles/' + uid).get()).exists, false);
    assert.deepEqual(await nicknameStatus('Perfil Original'), { status: 'taken' });
    console.log('[registration:e2e] PASS pending reservation returns only nickname availability');

    // A propriedade do apelido não autoriza contas suspensas a reservá-lo.
    await privateRef.update({ suspended: true });
    await rejects(reserve, { nickname: 'Perfil Original' }, 'failed-precondition');
    await privateRef.update({ suspended: false });
    await rejects(reserveOther, { nickname: 'PERFIL Alternativo' }, 'already-exists');
    assert.equal((await otherRef.get()).get('nickname'), '');
    const legacy = makeClient('legacy');
    const { user: legacyUser } = await createUserWithEmailAndPassword(
      legacy.auth, 'legacy-' + token + '@example.test', 'Legacy-2026-Aa1!',
    );
    const legacyRef = db.doc('users/' + legacyUser.uid);
    await waitFor('legacy account seed', async () => (await legacyRef.get()).exists);
    await legacyRef.update({ nickname: 'Legado Antigo' });
    await db.doc('public_index/nickname:legado_antigo').set({
      uid: legacyUser.uid, type: 'nickname', value: 'legado_antigo',
    });
    assert.deepEqual(await nicknameStatus('Legado'), { status: 'taken' });
    await rejects(reserveOther, { nickname: 'Legado Novo' }, 'already-exists');
    assert.equal((await db.doc('nickname_reservations/legado').get()).exists, false);

    await rejects(reserve, { nickname: 'Outro Apelido' }, 'failed-precondition');
    assert.equal((await db.doc('nickname_reservations/outro').get()).exists, false);
    assert.equal((await reserve({ nickname: 'Perfil Original' })).data.normalized, 'perfil');
    assert.equal((await recover({ expectedUid: uid })).data.created, false);
    assert.equal((await privateRef.get()).get('nickname'), 'Perfil Original');
    console.log('[registration:e2e] PASS ownership, collision and idempotence');

    const profileFields = {
      nickname: 'Perfil Original', gender: 'homem',
      orientation: 'heterossexual', estado: 'RJ', municipio: 'Rio de Janeiro',
    };
    await grantEligibility(db, adminAuth, legacyUser.uid);
    const completeLegacy = httpsCallable(legacy.functions, 'completeRegistrationProfile');
    assert.equal((await completeLegacy({
      ...profileFields, uid: legacyUser.uid, nickname: 'Legado Antigo',
    })).data.status, 'COMPLETED');
    assert.equal((await db.doc('public_profiles/' + legacyUser.uid).get())
      .get('nicknameNormalized'), 'legado_antigo');
    assert.equal((await db.doc('nickname_reservations/legado').get()).exists, false);
    const payload = { ...profileFields, uid };
    await rejects(complete, payload, 'failed-precondition');
    assert.equal((await db.doc('public_profiles/' + uid).get()).exists, false);
    await adminAuth.updateUser(uid, { emailVerified: true });
    await rejects(complete, payload, 'failed-precondition');
    // O aceite de Termos desatualizado ou sem aviso de privacidade não conclui o cadastro.
    await privateRef.set({
      acceptedTerms: { accepted: true, version: 'v2', acknowledgedPrivacyNotice: true },
    }, { merge: true });
    await rejects(complete, payload, 'failed-precondition');
    await privateRef.set({
      acceptedTerms: { accepted: true, version: 'v3', acknowledgedPrivacyNotice: false },
    }, { merge: true });
    await rejects(complete, payload, 'failed-precondition');
    await privateRef.set({
      acceptedTerms: { accepted: true, version: 'v3', acknowledgedPrivacyNotice: true },
    }, { merge: true });
    await rejects(complete, payload, 'permission-denied');
    assert.equal((await privateRef.get()).get('profileCompleted'), false);
    await grantEligibility(db, adminAuth, uid);
    assert.equal((await complete(payload)).data.status, 'COMPLETED');
    const publicRef = db.doc('public_profiles/' + uid);
    assert.equal((await privateRef.get()).get('profileCompleted'), true);
    assert.equal((await publicRef.get()).get('nicknameNormalized'), 'perfil');
    assert.deepEqual(await nicknameStatus('Perfil'), { status: 'taken' });
    assert.deepEqual(await nicknameStatus('Perfil Outro'), { status: 'taken' });
    assert.equal((await complete(payload)).data.status, 'COMPLETED');
    await rejects(complete, { ...payload, nickname: 'Perfil Alterado' }, 'failed-precondition');
    assert.equal((await db.doc('public_index/nickname:perfil').get()).get('uid'), uid);
    console.log('[registration:e2e] PASS eligibility, completion, repeat and immutable nickname');

    const publishedIndex = db.doc('public_index/nickname:perfil');
    const publishedIndexData = (await publishedIndex.get()).data();
    await privateRef.update({ publicVisibility: 'hidden' });
    await publishedIndex.delete();
    assert.deepEqual(await nicknameStatus('Perfil'), { status: 'taken' });
    await rejects(reserveOther, { nickname: 'Perfil Alternativo' }, 'already-exists');
    assert.equal((await publishedIndex.get()).exists, false);
    await privateRef.update({ publicVisibility: 'visible' });
    await publishedIndex.set(publishedIndexData);
    console.log('[registration:e2e] PASS hidden owner keeps principal after public index removal');

    await adminAuth.updateUser(otherUid, { emailVerified: true });
    await b.user.reload();
    await b.user.getIdToken(true);
    await otherRef.set({
      acceptedTerms: { accepted: true, version: 'v3', acknowledgedPrivacyNotice: true },
    }, { merge: true });
    const declareAge = httpsCallable(other.functions, 'acceptAdultSelfDeclaration');
    const declarationRef = db.doc('adult_self_declarations/' + otherUid);
    await rejects(declareAge, { confirmsAdult: true }, 'invalid-argument');
    const ageSessionError = await rejects(
      declareAge, { confirmsAdult: true, expectedUid: uid }, 'permission-denied'
    );
    assert.equal(ageSessionError.details?.reason, 'auth/session-changed');
    assert.equal((await declarationRef.get()).exists, false);
    assert.equal((await db.doc('age_eligibility_records/' + otherUid).get()).exists, false);
    const declaration = await declareAge({ confirmsAdult: true, expectedUid: otherUid });
    assert.equal(declaration.data.status, 'SELF_DECLARED_ADULT');
    assert.equal((await declarationRef.get()).get('uid'), otherUid);
    console.log('[registration:e2e] PASS 18+ declaration requires the initiating account');

    const otherProfile = { ...profileFields, nickname: 'Outra Conta' };
    const otherPublicRef = db.doc('public_profiles/' + otherUid);
    const otherReservationRef = db.doc('nickname_reservations/outra');
    const otherIndexRef = db.doc('public_index/nickname:outra');
    const otherBefore = (await otherRef.get()).data();
    await rejects(completeOther, otherProfile, 'invalid-argument');
    const sessionError = await rejects(
      completeOther, { ...otherProfile, uid }, 'permission-denied'
    );
    assert.equal(sessionError.details?.reason, 'auth/session-changed');
    assert.deepEqual((await otherRef.get()).data(), otherBefore);
    assert.equal((await otherPublicRef.get()).exists, false);
    assert.equal((await otherReservationRef.get()).exists, false);
    assert.equal((await otherIndexRef.get()).exists, false);
    console.log('[registration:e2e] PASS completion requires the UID of the initiating account');

    await rejects(completeOther, { ...profileFields, uid: otherUid }, 'already-exists');
    assert.equal((await otherRef.get()).get('profileCompleted'), false);
    assert.equal((await otherPublicRef.get()).exists, false);
    console.log('[registration:e2e] PASS second owner cannot claim completed nickname');

    assert.equal((await completeOther({ ...otherProfile, uid: otherUid })).data.status, 'COMPLETED');
    assert.equal((await otherRef.get()).get('profileCompleted'), true);
    assert.equal((await adminAuth.getUser(otherUid)).displayName, otherProfile.nickname);

    const signup = makeClient('signup');
    const secondDevice = makeClient('signup-second-device');
    const signupEmail = 'signup-' + token + '@example.test';
    const signupPassword = 'Signup-2026-Aa1!';
    const credential = await createUserWithEmailAndPassword(signup.auth, signupEmail, signupPassword);
    const signupUid = credential.user.uid;
    const signupUserRef = db.doc('users/' + signupUid);
    const signupEvidenceRef = db.doc('adult_self_declarations/' + signupUid);
    const signupEligibilityRef = db.doc('age_eligibility_records/' + signupUid);
    const acceptOnSignup = httpsCallable(signup.functions, 'acceptPlatformTerms');
    const signupConfirmations = {
      expectedUid: signupUid,
      acceptedTerms: true,
      acknowledgedPrivacyNotice: true,
      signupAdultDeclarationVersion: 'v1',
    };

    await waitFor('New signup seed', async () => (await signupUserRef.get()).exists);
    await rejects(
      acceptOnSignup, { ...signupConfirmations, expectedUid: uid }, 'permission-denied'
    );
    assert.equal((await signupEvidenceRef.get()).exists, false);
    const acceptFirst = (await acceptOnSignup(signupConfirmations)).data;
    const firstEvidence = (await signupEvidenceRef.get()).data();
    assert.equal(acceptFirst.signupAdultDeclarationRecorded, true);
    assert.equal(firstEvidence.evidenceOrigin, 'SIGNUP_FORM');
    assert.equal(firstEvidence.declarationText, 'Declaro voluntariamente que tenho 18 anos ou mais.');
    assert.equal(firstEvidence.termsAcceptedAtMs, acceptFirst.acceptedAtMs);
    assert.deepEqual((await acceptOnSignup(signupConfirmations)).data, acceptFirst);
    assert.deepEqual((await signupEvidenceRef.get()).data(), firstEvidence);

    const refreshOnSignup = httpsCallable(signup.functions, 'refreshMyAgeEligibility');
    assert.equal((await refreshOnSignup({})).data.status, 'UNVERIFIED');
    assert.equal((await signupEligibilityRef.get()).exists, false);

    await adminAuth.updateUser(signupUid, { emailVerified: true });
    await signInWithEmailAndPassword(secondDevice.auth, signupEmail, signupPassword);
    const refreshOnSecondDevice = httpsCallable(secondDevice.functions, 'refreshMyAgeEligibility');
    await signupUserRef.update({ accountLocked: true });
    assert.equal((await refreshOnSecondDevice({})).data.status, 'UNVERIFIED');
    assert.equal((await signupEligibilityRef.get()).exists, false);
    await signupUserRef.update({ accountLocked: false });

    assert.equal((await refreshOnSecondDevice({})).data.status, 'SELF_DECLARED_ADULT');
    assert.equal((await signupEligibilityRef.get()).get('uid'), signupUid);
    assert.deepEqual((await signupEvidenceRef.get()).data(), firstEvidence);
    const completeOnSecondDevice = httpsCallable(secondDevice.functions, 'completeRegistrationProfile');
    assert.equal((await completeOnSecondDevice({
      ...profileFields, uid: signupUid, nickname: 'Cadastro OutraAba',
    })).data.status, 'COMPLETED');
    console.log('[registration:e2e] PASS signup declaration is saved once and used after verification on another device');

    const contenderClients = ['first', 'second'].map(makeClient);
    const contenders = await Promise.all(contenderClients.map(async (client, index) => {
      const credential = await createUserWithEmailAndPassword(
        client.auth, 'race-' + index + '-' + token + '@example.test', 'Contender-2026-Aa1!',
      );
      return {
        uid: credential.user.uid,
        reserve: httpsCallable(client.functions, 'reserveRegistrationNickname'),
      };
    }));
    const outcomes = await Promise.allSettled(contenders.map(({ uid, reserve }, index) =>
      reserve({ nickname: index === 0 ? 'Disputa RJ' : 'DISPUTA SP', expectedUid: uid })
    ));
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    const rejectedIndex = outcomes.findIndex(outcome => outcome.status === 'rejected');
    assert.equal(outcomes[rejectedIndex].reason.code, 'functions/already-exists');
    const { uid: independentUid, reserve: reserveIndependent } = contenders[rejectedIndex];
    assert.equal((await reserveIndependent({
      nickname: 'Disputa_RJ', expectedUid: independentUid,
    })).data.normalized, 'disputa_rj');
    const legacyReservations = await db.collection('nickname_reservations').get();
    assert.equal(legacyReservations.empty, true);
    console.log('[registration:e2e] PASS one transaction owns a principal under concurrent signup');
  } finally {
    await Promise.allSettled(apps.map(deleteApp));
    await deleteAdminApp(admin);
  }
}
run().catch(e => { console.error('[registration:e2e] FAIL:', e); process.exitCode = 1; });
