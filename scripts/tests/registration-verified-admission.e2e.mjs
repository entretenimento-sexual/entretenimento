import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  connectAuthEmulator, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, signInWithCredential,
  sendSignInLinkToEmail, signInWithEmailAndPassword, signInWithEmailLink,
} from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-entretenimento-verified-e2e';
const authHost = '127.0.0.1:19099';
assert.equal(process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT, projectId);
assert.equal(process.env.AGE_ADMISSION_MODE, 'VERIFIED_REQUIRED');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, authHost);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');

const app = initializeApp({ projectId, apiKey: 'demo-api-key' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://' + authHost, { disableWarnings: true });
const functions = getFunctions(app, 'us-central1');
connectFunctionsEmulator(functions, '127.0.0.1', 15001);

const adminApp = initializeAdminApp({ projectId });
const adminAuth = getAdminAuth(adminApp);
const db = getFirestore(adminApp);
const password = 'ContaAutorizada18!';
const token = randomUUID();

async function expectAuthSignupDenied(create, email) {
  await assert.rejects(create, /verificação confiável de maioridade/);
  await assert.rejects(adminAuth.getUserByEmail(email), { code: 'auth/user-not-found' });
}

try {
  const email = `sem-prova-${token}@example.test`;
  await expectAuthSignupDenied(createUserWithEmailAndPassword(auth, email, password), email);

  const emailLinkAddress = `link-sem-prova-${token}@example.test`;
  await sendSignInLinkToEmail(auth, emailLinkAddress, {
    url: 'http://localhost:4200/register/continuar-por-email',
    handleCodeInApp: true,
  });
  const reply = await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/oobCodes`);
  assert.ok(reply.ok);
  const { oobCodes } = await reply.json();
  const link = oobCodes.findLast(code => code.email === emailLinkAddress && code.requestType === 'EMAIL_SIGNIN');
  assert.ok(link);
  const preview = httpsCallable(functions, 'prepareEmailLinkRegistration');
  await assert.rejects(preview({ code: link.oobCode, confirmsAdult: true }), { code: 'functions/not-found' });
  await expectAuthSignupDenied(signInWithEmailLink(auth, emailLinkAddress, link.oobLink), emailLinkAddress);
  const googleEmail = `google-sem-prova-${token}@example.test`;
  // O emulador aceita o JSON de um provedor simulado, sem contatar o Google.
  const google = GoogleAuthProvider.credential(JSON.stringify({
    sub: token, email: googleEmail, email_verified: true,
  }));
  await expectAuthSignupDenied(signInWithCredential(auth, google), googleEmail);
  console.log('[registration:verified] PASS password, email link and Google are blocked before a new UID');

  const account = await adminAuth.createUser({
    email: `fixture-administrativa-${token}@example.test`, password, emailVerified: true,
  });
  const uid = account.uid;
  const privateRef = db.doc('users/' + uid);
  const ageRef = db.doc('age_eligibility_records/' + uid);
  const credential = await signInWithEmailAndPassword(auth, account.email, password);
  assert.equal(credential.user.uid, uid);

  const recover = httpsCallable(functions, 'recoverRegistrationSeed');
  const reserve = httpsCallable(functions, 'reserveRegistrationNickname');
  const seedDenied = error => error.code === 'functions/failed-precondition' &&
    error.details?.reason === 'trusted_age_verification_required';

  await assert.rejects(recover({ expectedUid: uid }), seedDenied);
  await assert.rejects(reserve({ expectedUid: uid, nickname: 'Perfil Seguro' }), seedDenied);
  assert.equal((await privateRef.get()).exists, false);
  const now = Date.now();
  const verifiedRecord = {
    uid, status: 'VERIFIED_ADULT', policyVersion: 1,
    source: 'INITIAL_VERIFICATION', method: 'EXTERNAL_PROVIDER',
    verifiedAtMs: now - 5000, decidedAtMs: now - 5000, updatedAtMs: now,
    expiresAtMs: null,
  };
  for (const invalidRecord of [
    { ...verifiedRecord, uid: 'outra-conta' },
    { ...verifiedRecord, expiresAtMs: now - 1000 },
    {
      ...verifiedRecord, status: 'SELF_DECLARED_ADULT', source: 'SELF_DECLARATION', method: 'SELF_DECLARATION',
      verifiedAtMs: null, expiresAtMs: null,
    },
  ]) {
    await ageRef.set(invalidRecord);
    await assert.rejects(recover({ expectedUid: uid }), seedDenied);
    assert.equal((await privateRef.get()).exists, false);
  }

  await ageRef.set(verifiedRecord);
  assert.equal((await recover({ expectedUid: uid })).data.created, true);
  assert.equal((await recover({ expectedUid: uid })).data.created, false);
  const privateUser = (await privateRef.get()).data();
  assert.equal(privateUser.publicVisibility, 'hidden');
  assert.equal(privateUser.profileCompleted, false);
  assert.equal(privateUser.interactionBlocked, true);
  console.log('[registration:verified] PASS proof is UID-bound, current and trusted before private seed recovery');
} finally {
  await deleteApp(app);
  await deleteAdminApp(adminApp);
}
