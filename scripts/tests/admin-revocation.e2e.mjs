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
assert.equal(process.env.FUNCTIONS_EMULATOR, 'true');
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
const callable = httpsCallable(functions, 'moderateSuspendAccount');
const operation = { targetUid: 'not-a-real-user', reason: 'Test only' };

async function expectCallableCode(code) {
  await assert.rejects(callable(operation), (error) => {
    assert.equal(error.code, code);
    return true;
  });
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
  // Conta admin autorizada ultrapassa a autorização; alvo fictício provoca not-found.
  await expectCallableCode('functions/not-found');
  await db.doc(`users/${uid}`).update({ role: 'free', admin: false });
  assert.equal(await credential.user.getIdToken(), jwtBefore, 'JWT mudou após revogação');
  await expectCallableCode('functions/permission-denied');
  await db.doc(`users/${uid}`).update({ role: 'admin' });
  await expectCallableCode('functions/not-found');
  console.log('[authz-e2e] OK: Callable real negou JWT antigo e retomou após restauração.');
} finally {
  if (uid) {
    await db.doc(`users/${uid}`).delete();
    await adminAuth.deleteUser(uid);
  }
  await deleteApp(client);
  await deleteAdminApp(admin);
}
