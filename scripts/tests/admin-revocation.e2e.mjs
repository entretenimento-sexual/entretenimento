// End-to-end, apenas Firebase Emulator: Callable real e JWT preservado.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const HOST = '127.0.0.1';
const AUTH_PORT = 19099, FIRESTORE_PORT = 18080, FUNCTIONS_PORT = 15001;
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, `${HOST}:${AUTH_PORT}`);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, `${HOST}:${FIRESTORE_PORT}`);
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;

const runId = randomUUID();
const client = initializeApp({
  projectId: PROJECT_ID,
  apiKey: 'fake-api-key',
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
}, `admin-revocation-client-${runId}`);
const auth = getAuth(client);
connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, { disableWarnings: true });
const functions = getFunctions(client, 'us-central1');
connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);
const admin = initializeAdminApp({ projectId: PROJECT_ID }, `admin-revocation-server-${runId}`);
const adminAuth = getAdminAuth(admin);
const db = getFirestore(admin);
let uid = '';
const accountModeration = httpsCallable(functions, 'moderateSuspendAccount');
const accountOperation = { targetUid: 'not-a-real-user', reason: 'Test only' };
const reviewOperation = {
  reportId: 'missing-report-' + runId,
  decision: 'KEEP',
  resolution: 'Cenário sintético de autorização',
};
const staffOperations = [
  ['reviewPhotoContentReport', reviewOperation],
  ['reviewVideoContentReport', reviewOperation],
  ['reviewMediaModerationContest', { ...reviewOperation, decision: 'UPHOLD' }],
  ['reviewCommunityFeedPostReport', reviewOperation],
  ['reviewCommunityFeedCommentReport', reviewOperation],
  ['reviewCommunityFeedCommentReplyReport', reviewOperation],
].map(([name, data]) => ({ name, callable: httpsCallable(functions, name), data }));

async function expectCallableCode(callable, data, code, operationName) {
  await assert.rejects(callable(data), (error) => {
    assert.equal(error.code, code, operationName);
    return true;
  });
}

async function expectPlatformReviewCode(code) {
  for (const { name, callable, data } of staffOperations) {
    await expectCallableCode(callable, data, code, name);
  }
}

async function expectAccountCode(code) {
  await expectCallableCode(accountModeration, accountOperation, code, 'moderateSuspendAccount');
}

try {
  const credential = await createUserWithEmailAndPassword(
    auth, `revocation-${runId}@example.test`, 'Testing-Only-123!Aa'
  );
  uid = credential.user.uid;
  await adminAuth.setCustomUserClaims(uid, { admin: true });
  await db.doc(`users/${uid}`).set({
    role: 'admin', accountStatus: 'active',
    suspended: false, accountLocked: false,
    interactionBlocked: false, loginAllowed: true,
  });
  // Forçar apenas uma vez, antes da revogação; manter o JWT idêntico depois.
  const jwtBefore = await credential.user.getIdToken(true);
  // Os dados fictícios não geram mutação mesmo quando a autorização passa.
  await expectAccountCode('functions/not-found');
  await expectPlatformReviewCode('functions/not-found');

  await db.doc('users/' + uid).update({ role: 'free', admin: false });
  assert.equal(await credential.user.getIdToken(), jwtBefore, 'JWT mudou após revogação');
  await expectAccountCode('functions/permission-denied');
  await expectPlatformReviewCode('functions/permission-denied');

  await db.doc('users/' + uid).update({ permissions: ['users:suspend'] });
  await expectAccountCode('functions/not-found');
  await expectPlatformReviewCode('functions/permission-denied');

  await db.doc('users/' + uid).update({ role: 'admin', accountLocked: true });
  await expectAccountCode('functions/permission-denied');
  await expectPlatformReviewCode('functions/permission-denied');

  await db.doc('users/' + uid).update({ accountLocked: false });
  await expectAccountCode('functions/not-found');
  await expectPlatformReviewCode('functions/not-found');
  assert.equal(await credential.user.getIdToken(), jwtBefore, 'JWT mudou durante o teste');
  console.log('[authz-e2e] OK: contas, mídia e mural respeitam revogação, escopo e bloqueio com o mesmo JWT.');

} finally {
  if (uid) {
    await db.doc(`users/${uid}`).delete();
    await adminAuth.deleteUser(uid);
  }
  await deleteApp(client);
  await deleteAdminApp(admin);
}
