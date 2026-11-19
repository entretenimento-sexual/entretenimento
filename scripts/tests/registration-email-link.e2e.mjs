import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  connectAuthEmulator, EmailAuthProvider, getAuth, reauthenticateWithCredential, sendSignInLinkToEmail,
  signInWithEmailLink, signInWithEmailAndPassword, updatePassword,
} from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const projectId = 'demo-entretenimento-media-e2e';
const authHost = '127.0.0.1:19099';
assert.equal(process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT, projectId);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, authHost);

const run = randomUUID();
const apps = [];
const password = 'SenhaValidacao123!';
const adminApp = initializeAdminApp({ projectId }, 'email-link-check-' + run);
const adminAuth = getAdminAuth(adminApp);
const db = getFirestore(adminApp);

function client(name) {
  const app = initializeApp({ projectId, apiKey: 'fake-api-key' }, name + '-' + run);
  apps.push(app);
  const auth = getAuth(app);
  const functions = getFunctions(app, 'us-central1');
  connectAuthEmulator(auth, 'http://' + authHost, { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 15001);
  return { auth, call: (name, data) => httpsCallable(functions, name)(data) };
}

async function issueLink(auth, email, draftId) {
  const url = new URL('http://localhost:4200/register/continuar-por-email');
  if (draftId) url.searchParams.set('draft', draftId);
  await sendSignInLinkToEmail(auth, email, {
    url: url.href,
    handleCodeInApp: true,
  });
  const codes = await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/oobCodes`);
  assert.equal(codes.status, 200);
  const { oobCodes } = await codes.json();
  const link = oobCodes.findLast(code => code.email === email && code.requestType === 'EMAIL_SIGNIN');
  assert.ok(link, 'Auth Emulator should generate an email-sign-in link');
  return link;
}

async function rejects(action, code, reason) {
  await assert.rejects(action, error => error.code === 'functions/' + code &&
    (!reason || error.details?.reason === reason));
}

try {
  const sender = client('sender');
  const consumer = client('consumer');
  const email = `novo-${run}@example.test`;
  const nickname = 'Teste' + run.slice(0, 6);
  const { data: { draftId } } = await sender.call('stageEmailLinkRegistration', { email, nickname });
  const { oobCode, oobLink } = await issueLink(sender.auth, email, draftId);
  const prepare = { code: oobCode, confirmsAdult: true };
  assert.deepEqual((await consumer.call('inspectEmailLinkRegistration', { code: oobCode })).data, { state: 'confirm' });
  await assert.rejects(adminAuth.getUserByEmail(email), { code: 'auth/user-not-found' });
  assert.deepEqual((await consumer.call('inspectEmailLinkRegistration', { code: 'unknown-code' })).data, { state: 'unavailable' });
  const expiredEmail = `expired-${run}@example.test`;
  const expiredDraft = await sender.call('stageEmailLinkRegistration', { email: expiredEmail, nickname });
  const expiredLink = await issueLink(sender.auth, expiredEmail, expiredDraft.data.draftId);
  await db.collection('registration_email_link_drafts').doc(expiredDraft.data.draftId).update({ expiresAtMs: 1 });
  assert.deepEqual((await consumer.call('inspectEmailLinkRegistration', { code: expiredLink.oobCode })).data,
    { state: 'draft-expired' });
  await rejects(consumer.call('prepareEmailLinkRegistration', { code: expiredLink.oobCode, confirmsAdult: true }),
    'failed-precondition', 'registration/email-link-draft-expired');
  await assert.rejects(adminAuth.getUserByEmail(expiredEmail), { code: 'auth/user-not-found' });
  await rejects(consumer.call('prepareEmailLinkRegistration', { ...prepare, confirmsAdult: false }), 'invalid-argument');
  await rejects(consumer.call('prepareEmailLinkRegistration', { ...prepare, email: 'outro@example.test' }),
    'failed-precondition', 'registration/email-link-unavailable');
  await assert.rejects(adminAuth.getUserByEmail(email), { code: 'auth/user-not-found' });

  const [first, second] = await Promise.all([
    consumer.call('prepareEmailLinkRegistration', prepare),
    sender.call('prepareEmailLinkRegistration', prepare),
  ]);
  const { uid } = first.data;
  assert.equal(second.data.uid, uid, 'Parallel preparations must reserve the same Auth identity');
  assert.equal(first.data.email, email, 'The emulator must resolve the recipient from the link');
  const credential = await signInWithEmailLink(consumer.auth, first.data.email, oobLink);
  assert.equal(credential.user.uid, uid);
  const expectedUid = { expectedUid: uid };
  const state = (expectedUid) => consumer.call('getEmailLinkRegistrationState', { expectedUid });
  assert.equal((await state(uid)).data.passwordRequired, true);
  await rejects(state('another-account'), 'permission-denied');
  for (const [name, data] of [
    ['acceptPlatformTerms', { ...expectedUid, acceptedTerms: true, acknowledgedPrivacyNotice: true }],
    ['acceptAdultSelfDeclaration', expectedUid],
    ['completeRegistrationProfile', { uid }],
    ['reserveRegistrationNickname', { ...expectedUid, nickname: 'ApelidoTeste' }],
  ]) {
    await rejects(consumer.call(name, data), 'failed-precondition', 'registration/password-required');
  }

  // A sessão por link precisa ser anterior à revogação gerada pela mudança de senha.
  await new Promise(resolve => setTimeout(resolve, 1_100));
  await updatePassword(credential.user, password);
  await reauthenticateWithCredential(credential.user, EmailAuthProvider.credential(email, password));
  assert.deepEqual((await state(uid)).data, { passwordRequired: false, nickname });
  const reservation = await consumer.call('reserveRegistrationNickname', { ...expectedUid, nickname });
  assert.equal(reservation.data.nickname, nickname);
  const privateRef = db.collection('users').doc(uid);
  const declarationRef = db.collection('adult_self_declarations').doc(uid);
  const indexRef = db.collection('public_index').doc('nickname:' + nickname.toLowerCase());
  const publicRef = db.collection('public_profiles').doc(uid);
  const beforeTerms = (await privateRef.get()).data();
  assert.equal(beforeTerms.nickname, nickname);
  assert.equal(beforeTerms.emailVerified, true);
  assert.ok(beforeTerms.authProviders.includes('password'));
  assert.equal(beforeTerms.profileCompleted, false);
  assert.equal(beforeTerms.acceptedTerms.accepted, false);
  assert.equal((await adminAuth.getUser(uid)).displayName, nickname);
  assert.equal((await indexRef.get()).get('uid'), uid);
  assert.equal((await publicRef.get()).exists, false);
  assert.equal((await declarationRef.get()).exists, false);
  const terms = { ...expectedUid, acceptedTerms: true, acknowledgedPrivacyNotice: true };
  assert.equal((await consumer.call('acceptPlatformTerms', terms)).data.signupAdultDeclarationRecorded, true);
  const declared = (await declarationRef.get()).data();
  assert.ok(declared.declaredAtMs <= declared.termsAcceptedAtMs);
  assert.equal(declared.legalSnapshotCapturedAtDeclaration, false);
  await consumer.call('refreshMyAgeEligibility', {});
  assert.equal((await db.collection('age_eligibility_records').doc(uid).get()).get('status'), 'SELF_DECLARED_ADULT');
  await consumer.call('acceptPlatformTerms', terms);
  assert.equal((await declarationRef.get()).get('declaredAtMs'), declared.declaredAtMs);
  await consumer.call('completeRegistrationProfile', {
    uid, nickname, gender: 'homem', orientation: 'pansexual', estado: 'RJ', municipio: 'Rio de Janeiro',
  });
  const completed = (await privateRef.get()).data();
  assert.equal(completed.profileCompleted, true);
  assert.equal(completed.gender, 'homem');
  assert.equal(completed.orientation, 'pansexual');
  const publicProfile = (await publicRef.get()).data();
  assert.equal(publicProfile.nickname, nickname);
  assert.equal(publicProfile.orientation, 'pansexual');
  assert.equal('email' in publicProfile, false);
  assert.equal((await signInWithEmailAndPassword(sender.auth, email, password)).user.uid, uid);
  const guestWithUsedLink = client('used-link');
  assert.deepEqual((await guestWithUsedLink.call('inspectEmailLinkRegistration', { code: oobCode })).data,
    { state: 'sign-in' });
  await rejects(guestWithUsedLink.call('prepareEmailLinkRegistration', prepare),
    'failed-precondition', 'registration/account-already-created');
  console.log('[email-link:e2e] PASS new identity, single-use link, password and protected onboarding');

  for (const emailVerified of [false, true]) {
    const email = `legado-${emailVerified}-${run}@example.test`;
    const guest = client('legacy-' + emailVerified);
    const { oobCode } = await issueLink(guest.auth, email);
    const existing = await adminAuth.createUser({ email, password, emailVerified });
    assert.deepEqual((await guest.call('inspectEmailLinkRegistration', { code: oobCode })).data,
      { state: 'sign-in' });
    await rejects(guest.call('prepareEmailLinkRegistration', { code: oobCode, confirmsAdult: true }),
      'failed-precondition', 'registration/account-already-created');
    const signIn = await signInWithEmailAndPassword(guest.auth, email, password);
    assert.equal(signIn.user.uid, existing.uid);
    assert.equal(signIn.user.emailVerified, emailVerified);
  }
  console.log('[email-link:e2e] PASS legacy accounts retain UID, password and email verification');
} finally {
  await Promise.all(apps.map(app => deleteApp(app)));
  await deleteAdminApp(adminApp);
}
