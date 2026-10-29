// E2E da audiencia de videos: nenhuma consulta publica pode substituir a
// autorizacao social. Utiliza exclusivamente emuladores demo-*, sem dados reais.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp as deleteClientApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator, createUserWithEmailAndPassword,
  deleteUser, getAuth,
} from 'firebase/auth';
import {
  connectFunctionsEmulator, getFunctions, httpsCallable,
} from 'firebase/functions';
import {
  applicationDefault, deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { seedPublicMediaCompliance } from './media-e2e-compliance-fixture.mjs';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FIRESTORE_PORT = 18080;
const FUNCTIONS_PORT = 15001;

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${AUTH_PORT}`;

function client(label) {
  const app = initializeApp({
    apiKey: 'fake-api-key',
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
  }, label);
  const auth = getAuth(app);
  const functions = getFunctions(app, 'us-central1');
  connectAuthEmulator(auth, `http://${HOST}:${AUTH_PORT}`, {
    disableWarnings: true,
  });
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);
  return { app, auth, functions, user: null };
}

async function waitForUser(db, uid) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await db.doc(`users/${uid}`).get()).exists) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Seed de conta não foi criado pelo emulador.');
}

function videoFixture(ownerUid, videoId, visibility, publishedAt) {
  return {
    id: videoId, ownerUid, mediaType: 'VIDEO', visibility,
    moderationStatus: 'APPROVED', orderIndex: 0, publishedAt,
    createdAt: publishedAt, updatedAt: publishedAt, assetVersion: publishedAt,
    mimeType: 'video/mp4', sizeBytes: 512, durationMs: 10_000,
    posterAccess: 'SIGNED_URL', assetAccess: 'SIGNED_URL',
    title: 'Vídeo do teste de audiência', commentsEnabled: false,
  };
}

async function run() {
  assert.match(PROJECT_ID, /^demo-/);
  const id = randomUUID();
  const owner = client(`video-friends-owner-${id}`);
  const visitor = client(`video-friends-visitor-${id}`);
  const admin = initializeAdminApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
  }, `video-friends-admin-${id}`);
  const db = getFirestore(admin);
  let ownerUid = '';
  let visitorUid = '';
  try {
    const [ownerAuth, visitorAuth] = await Promise.all([
      createUserWithEmailAndPassword(owner.auth,
        `friends-owner-${id}@example.test`, `Owner-${id}-Aa1!`),
      createUserWithEmailAndPassword(visitor.auth,
        `friends-visitor-${id}@example.test`, `Visitor-${id}-Aa1!`),
    ]);
    owner.user = ownerAuth.user;
    visitor.user = visitorAuth.user;
    ownerUid = owner.user.uid;
    visitorUid = visitor.user.uid;
    await Promise.all([waitForUser(db, ownerUid), waitForUser(db, visitorUid)]);
    await seedPublicMediaCompliance(db, [ownerUid, visitorUid]);

    const publicId = `public-${id}`;
    const friendsId = `friends-${id}`;
    const publishedAt = Date.now();
    const publicProjection = videoFixture(ownerUid, publicId,
      'PUBLIC', publishedAt);
    const friendsProjection = videoFixture(ownerUid, friendsId,
      'FRIENDS', publishedAt + 1);
    const publicRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${publicId}`);
    const friendsRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${friendsId}`);
    const friendsPublicationRef = db.doc(
      `users/${ownerUid}/video_publications/${friendsId}`);
    const publication = (v) => ({
      ownerUid, videoId: v.id, isPublished: true,
      visibility: v.visibility, moderationStatus: 'APPROVED',
    });

    await Promise.all([
      db.doc(`public_profiles/${ownerUid}`).set({ uid: ownerUid,
        nickname: 'Proprietário', publicVisibility: 'visible' }),
      db.doc(`public_profiles/${visitorUid}`).set({ uid: visitorUid,
        nickname: 'Visitante', publicVisibility: 'visible' }),
      publicRef.set(publicProjection),
      friendsRef.set(friendsProjection),
      db.doc(`users/${ownerUid}/video_publications/${publicId}`)
        .set(publication(publicProjection)),
      friendsPublicationRef.set(publication(friendsProjection)),
    ]);

    const ownerPage = httpsCallable(owner.functions,
      'getAuthorizedVideoOwnerPage');
    const visitorPage = httpsCallable(visitor.functions,
      'getAuthorizedVideoOwnerPage');
    const request = { ownerUid, pageSize: 8, cursor: null };
    const visible = async (callable) =>
      (await callable(request)).data.items.map((item) => item.id).sort();

    assert.deepEqual(await visible(ownerPage), [friendsId, publicId].sort(),
      'O autor precisa ver suas próprias publicações sociais.');
    assert.deepEqual(await visible(visitorPage), [publicId],
      'Visitante sem amizade não pode enumerar FRIENDS.');

    const actorFriendRef = db.doc(
      `users/${visitorUid}/friends/${ownerUid}`);
    const targetFriendRef = db.doc(
      `users/${ownerUid}/friends/${visitorUid}`);
    await actorFriendRef.set({ createdAt: Date.now() });
    assert.deepEqual(await visible(visitorPage), [publicId],
      'Declaração unilateral de amizade não libera vídeos.');
    await targetFriendRef.set({ createdAt: Date.now() });
    assert.deepEqual(await visible(visitorPage), [friendsId, publicId].sort(),
      'Amizade recíproca deve permitir PUBLIC e FRIENDS.');

    const blockRef = db.doc(
      `users/${ownerUid}/blocks/${visitorUid}`);
    await blockRef.set({ isBlocked: true });
    assert.deepEqual(await visible(visitorPage), [],
      'Bloqueio do autor deve ocultar todas as publicações.');
    await blockRef.delete();

    await actorFriendRef.delete();
    assert.deepEqual(await visible(visitorPage), [publicId],
      'Desfazer amizade deve revogar a enumeração de FRIENDS.');
    await actorFriendRef.set({ createdAt: Date.now() });
    await friendsPublicationRef.update({ isPublished: false });
    assert.deepEqual(await visible(visitorPage), [publicId],
      'Publicação removida não pode reaparecer via projeção desatualizada.');

    console.log('✔ vídeos FRIENDS: proprietário, não-amigo, unilateral, recíproca, bloqueio, revogação e despublicação');
  } finally {
    const tasks = [];
    for (const uid of [ownerUid, visitorUid]) {
      if (!uid) continue;
      tasks.push(db.recursiveDelete(db.doc(`users/${uid}`)).catch(() => undefined));
      tasks.push(db.recursiveDelete(db.doc(`public_profiles/${uid}`)).catch(() => undefined));
    }
    for (const person of [owner, visitor]) {
      if (person.user) tasks.push(deleteUser(person.user).catch(() => undefined));
    }
    await Promise.all(tasks);
    await Promise.all([
      deleteClientApp(owner.app).catch(() => undefined),
      deleteClientApp(visitor.app).catch(() => undefined),
      deleteAdminApp(admin).catch(() => undefined),
    ]);
  }
}

run().catch((error) => {
  console.error('✖ testes integrados de audiência FRIENDS em vídeos falharam');
  console.error(error);
  process.exitCode = 1;
});
