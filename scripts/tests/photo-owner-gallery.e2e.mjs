// Verifica a consulta AUTORIZADA da galeria de fotos do autor em emuladores.
// Projeto demo-* isolado: não toca dados reais nem o snapshot local do usuário.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deleteApp as deleteClientApp, initializeApp as initializeClientApp } from 'firebase/app';
import {
  connectAuthEmulator, createUserWithEmailAndPassword, deleteUser, getAuth,
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
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GCP_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:18080`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:19099`;

function createClient(label) {
  const app = initializeClientApp({
    apiKey: 'fake-api-key',
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
  }, label);
  const auth = getAuth(app);
  const functions = getFunctions(app, 'us-central1');
  connectAuthEmulator(auth, `http://${HOST}:19099`, { disableWarnings: true });
  connectFunctionsEmulator(functions, HOST, 15001);
  return { app, auth, functions, user: null };
}

async function waitForUser(db, uid) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if ((await db.doc(`users/${uid}`).get()).exists) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Conta não ficou disponível no emulador.');
}

async function loadAllPages(callable, ownerUid, pageSize) {
  const ids = [];
  const seenCursors = new Set();
  let cursor = null;
  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const result = (await callable({ ownerUids: [ownerUid], pageSize, cursor })).data;
    ids.push(...result.items.map((item) => item.id));
    if (!result.hasMore) return ids;
    assert.ok(result.nextCursor, 'Página com hasMore exige cursor.');
    const key = JSON.stringify(result.nextCursor);
    assert.ok(!seenCursors.has(key), 'Cursor nunca deve ficar preso em loop.');
    seenCursors.add(key);
    cursor = result.nextCursor;
  }
  assert.fail('Número de páginas excedeu o limite de segurança do teste.');
}

async function run() {
  assert.match(PROJECT_ID, /^demo-/);
  const runId = randomUUID();
  const owner = createClient(`owner-gallery-${runId}`);
  const visitor = createClient(`visitor-gallery-${runId}`);
  const admin = initializeAdminApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
  }, `owner-gallery-admin-${runId}`);
  const db = getFirestore(admin);
  let ownerUid = '';
  let visitorUid = '';

  try {
    const [ownerAuth, visitorAuth] = await Promise.all([
      createUserWithEmailAndPassword(owner.auth,
        `owner-gallery-${runId}@example.test`, `Owner-${runId}-Aa1!`),
      createUserWithEmailAndPassword(visitor.auth,
        `visitor-gallery-${runId}@example.test`, `Visitor-${runId}-Aa1!`),
    ]);
    owner.user = ownerAuth.user;
    visitor.user = visitorAuth.user;
    ownerUid = owner.user.uid;
    visitorUid = visitor.user.uid;

    await Promise.all([waitForUser(db, ownerUid), waitForUser(db, visitorUid)]);
    await seedPublicMediaCompliance(db, [ownerUid, visitorUid]);
    await Promise.all([
      db.doc(`public_profiles/${ownerUid}`).set({
        uid: ownerUid, nickname: 'Autor', publicVisibility: 'visible',
      }, { merge: true }),
      db.doc(`public_profiles/${visitorUid}`).set({
        uid: visitorUid, nickname: 'Visitante', publicVisibility: 'visible',
      }, { merge: true }),
    ]);

    const now = Date.now();
    const batch = db.batch();
    const publicIds = [];
    const friendsIds = [];

    for (let index = 0; index < 32; index++) {
      const photoId = `gallery-check-${runId}-${String(index + 1).padStart(3, '0')}`;
      const visibility = index < 30 ? 'PUBLIC' : 'FRIENDS';
      (visibility === 'PUBLIC' ? publicIds : friendsIds).push(photoId);
      const publishedAt = now - index * 1000;
      batch.set(db.doc(`public_profiles/${ownerUid}/public_photos/${photoId}`), {
        id: photoId,
        ownerUid,
        mediaType: 'PHOTO',
        visibility,
        moderationStatus: 'APPROVED',
        publishedAt,
        assetAccess: 'SIGNED_URL',
      });
      batch.set(db.doc(`users/${ownerUid}/photo_publications/${photoId}`), {
        ownerUid,
        photoId,
        visibility,
        isPublished: true,
        moderationStatus: 'APPROVED',
        publishedAt,
      });
    }
    await batch.commit();

    const sourceDocs = await db.collection(`users/${ownerUid}/photos`)
      .limit(1).get();
    assert.equal(sourceDocs.empty, true,
      'A listagem não pode depender de documentos de originais privados.');

    const ownerCallable = httpsCallable(owner.functions, 'getAuthorizedPhotoOwnerPage');
    const visitorCallable = httpsCallable(visitor.functions, 'getAuthorizedPhotoOwnerPage');

    const ownerItems = await loadAllPages(ownerCallable, ownerUid, 24);
    assert.equal(ownerItems.length, 32, 'Autor deve listar todas as 32 publicações.');
    assert.equal(new Set(ownerItems).size, 32, 'Paginação não pode duplicar IDs.');
    assert.deepEqual(new Set(ownerItems), new Set([...publicIds, ...friendsIds]));

    const visitorItems = await loadAllPages(visitorCallable, ownerUid, 24);
    assert.equal(visitorItems.length, 30,
      'Visitante sem amizade deve ver só as 30 publicações PUBLIC.');
    assert.deepEqual(new Set(visitorItems), new Set(publicIds));

    // A projeção fica obsoleta, mas a publicação é retirada.
    const revokedId = publicIds[0];
    await db.doc(`users/${ownerUid}/photo_publications/${revokedId}`)
      .update({ isPublished: false });

    const afterRevocation = (await visitorCallable({
      ownerUids: [ownerUid], pageSize: 4, cursor: null,
    })).data.items.map((item) => item.id);
    assert.ok(!afterRevocation.includes(revokedId),
      'Projeção obsoleta nunca pode expor uma foto despublicada.');

    console.log('✔ galeria de fotos autorizada: 32 publicações, 24+8, IDs únicos, sem origem privada');
    console.log('✔ visitante: 30 PUBLIC, FRIENDS isolado e despublicação respeitada');
  } finally {
    const tasks = [];
    for (const uid of [ownerUid, visitorUid]) {
      if (!uid) continue;
      tasks.push(db.recursiveDelete(db.doc(`users/${uid}`)).catch(() => undefined));
      tasks.push(db.recursiveDelete(db.doc(`public_profiles/${uid}`))
        .catch(() => undefined));
    }
    for (const client of [owner, visitor]) {
      if (client.user) tasks.push(deleteUser(client.user).catch(() => undefined));
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
  console.error('✖ falha na integração da galeria autorizada de fotos');
  console.error(error);
  process.exitCode = 1;
});
