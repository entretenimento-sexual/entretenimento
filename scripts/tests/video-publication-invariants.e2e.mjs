import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  deleteApp as deleteClientApp,
  initializeApp as initializeClientApp,
} from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import {
  applicationDefault,
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const PROJECT_ID = 'demo-entretenimento-media-draft-functions';
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FUNCTIONS_PORT = 15001;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${AUTH_PORT}`;

async function run() {
  const runId = randomUUID();
  const email = `video-publication-owner-${runId}@example.test`;
  const password = `E2e-${runId}-Aa1!`;
  const adminApp = initializeAdminApp(
    {
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    },
    `video-publication-admin-${runId}`
  );
  const adminAuth = getAdminAuth(adminApp);
  const clientApp = initializeClientApp(
    {
      apiKey: 'fake-api-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      storageBucket: `${PROJECT_ID}.appspot.com`,
    },
    `video-publication-client-${runId}`
  );
  const clientAuth = getAuth(clientApp);
  let ownerUid = '';

  connectAuthEmulator(clientAuth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });

  try {
    const owner = await adminAuth.createUser({
      email,
      password,
      emailVerified: true,
    });
    ownerUid = owner.uid;
    await signInWithEmailAndPassword(clientAuth, email, password);

    const functions = getFunctions(clientApp, 'us-central1');
    connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);
    const unpublishVideo = httpsCallable(functions, 'unpublishVideo');

    await assert.rejects(
      () => unpublishVideo({
        ownerUid,
        videoId: `video-${runId}`,
      }),
      (error) => {
        assert.equal(error.code, 'functions/failed-precondition');
        assert.match(error.message, /exclua o vídeo definitivamente/i);
        return true;
      }
    );

    console.log('video-publication-invariants.e2e: ok');
  } finally {
    if (ownerUid) {
      await adminAuth.deleteUser(ownerUid).catch(() => undefined);
    }
    await deleteClientApp(clientApp).catch(() => undefined);
    await deleteAdminApp(adminApp).catch(() => undefined);
  }
}

await run();
