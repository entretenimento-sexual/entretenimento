// Two isolated signed-in clients against REAL emulator Functions and Firestore Rules.
// Never connects to production or the developer's persistent emulator snapshot.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth, connectAuthEmulator, signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFunctions, connectFunctionsEmulator, httpsCallable,
} from 'firebase/functions';
import {
  getFirestore as getClientFirestore, connectFirestoreEmulator,
  collection, doc, getDoc, onSnapshot, query, where,
} from 'firebase/firestore';
import {
  initializeApp as initializeAdminApp, deleteApp as deleteAdminApp,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { seedPublicMediaCompliance } from './media-e2e-compliance-fixture.mjs';

const PROJECT = 'demo-entretenimento-media-e2e';
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FIRESTORE_PORT = 18080;
const FUNCTIONS_PORT = 15001;
const DEADLINE_MS = 30_000;

assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, HOST + ':' + AUTH_PORT);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, HOST + ':' + FIRESTORE_PORT);
assert.ok(process.env.FIREBASE_EMULATOR_HUB, 'Use emulators:exec.');
assert.equal(process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? PROJECT, PROJECT);
assert.match(PROJECT, /^demo-/);
process.env.GCLOUD_PROJECT = PROJECT;
process.env.GCP_PROJECT = PROJECT;

const id = randomUUID().replaceAll('-', '').slice(0, 16);
const password = 'Emulator-Only-123Aa!';
const apps = [];
const unsubscribe = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, read, accepts) {
  const deadline = Date.now() + DEADLINE_MS;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accepts(last)) return last;
    await pause(150);
  }
  throw new Error('Timeout aguardando ' + label + '; estado=' + JSON.stringify(last));
}

function makeClient(name) {
  const app = initializeApp({
    projectId: PROJECT, apiKey: 'fake-api-key',
    authDomain: PROJECT + '.firebaseapp.com',
  }, 'bilateral-' + name + '-' + id);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + HOST + ':' + AUTH_PORT, {
    disableWarnings: true,
  });
  const functions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);
  const firestore = getClientFirestore(app);
  connectFirestoreEmulator(firestore, HOST, FIRESTORE_PORT);
  apps.push(app);
  return { auth, functions, firestore };
}

function observeDocument(client, path) {
  const states = [];
  unsubscribe.push(onSnapshot(
    doc(client.firestore, path),
    (snapshot) => states.push(snapshot.exists() ? snapshot.data() : null),
    (error) => states.push({ observationError: error.code })
  ));
  return states;
}

function observeOwnBlocks(client, uid) {
  const states = [];
  unsubscribe.push(onSnapshot(
    query(collection(client.firestore, 'users', uid, 'blocks'), where('isBlocked', '==', true)),
    (snapshot) => states.push(snapshot.docs.map((entry) => entry.id)),
    (error) => states.push({ observationError: error.code })
  ));
  return states;
}

function latest(states) { return states.at(-1); }
async function waitAvailable(label, states, value) {
  await until(label, () => latest(states), (state) =>
    state !== undefined && state?.available === value && state?.version === 1
  );
}
async function expectDenied(operation, code) {
  await assert.rejects(operation(), (error) => {
    assert.equal(error.code, code);
    return true;
  });
}
async function lookup(call, uid) {
  const response = await call({ uids: [uid] });
  return response.data.items.map((item) => item.uid);
}

const admin = initializeAdminApp({ projectId: PROJECT }, 'bilateral-admin-' + id);
const adminAuth = getAdminAuth(admin);
const db = getAdminFirestore(admin);
const a = makeClient('a');
const b = makeClient('b');
const aUid = 'bilateral-a-' + id;
const bUid = 'bilateral-b-' + id;
const profile = (uid) => ({
  uid, nickname: 'Perfil ' + uid, nicknameNormalized: 'perfil-' + uid,
  gender: 'mulher', identityCode: 'mulher', identityCatalogVersion: 1,
  orientation: 'bissexual', role: 'free', municipio: 'Rio de Janeiro',
  estado: 'RJ', createdAt: new Date(), updatedAt: new Date(),
});

try {
  for (const uid of [aUid, bUid]) {
    await adminAuth.createUser({
      uid, email: uid + '@example.test', password, emailVerified: true,
    });
  }
  await seedPublicMediaCompliance(db, [aUid, bUid]);
  await Promise.all([
    db.doc('users/' + aUid).set({
      uid: aUid, nickname: 'Pessoa A', emailVerified: true,
      loginAllowed: true, accountLocked: false,
    }, { merge: true }),
    db.doc('users/' + bUid).set({
      uid: bUid, nickname: 'Pessoa B', emailVerified: true,
      loginAllowed: true, accountLocked: false,
    }, { merge: true }),
    db.doc('public_profiles/' + aUid).set(profile(aUid)),
    db.doc('public_profiles/' + bUid).set(profile(bUid)),
    db.doc('users/' + aUid + '/friends/' + bUid).set({ accepted: true }),
    db.doc('users/' + bUid + '/friends/' + aUid).set({ accepted: true }),
  ]);

  await Promise.all([
    signInWithEmailAndPassword(a.auth, aUid + '@example.test', password),
    signInWithEmailAndPassword(b.auth, bUid + '@example.test', password),
  ]);

  const aDiscovery = httpsCallable(a.functions, 'getPublicProfilesPage');
  const bDiscovery = httpsCallable(b.functions, 'getPublicProfilesPage');
  const ensureChat = httpsCallable(a.functions, 'ensureDirectChat');
  const bEnsureChat = httpsCallable(b.functions, 'ensureDirectChat');
  const bSend = httpsCallable(b.functions, 'sendDirectMessage');
  const aBlock = httpsCallable(a.functions, 'blockUser');
  const aUnblock = httpsCallable(a.functions, 'unblockUser');
  const bBlock = httpsCallable(b.functions, 'blockUser');
  const bUnblock = httpsCallable(b.functions, 'unblockUser');
  const reconcile = httpsCallable(a.functions, 'reconcileDirectChatAccess');

  assert.deepEqual(await lookup(aDiscovery, bUid), [bUid]);
  assert.deepEqual(await lookup(bDiscovery, aUid), [aUid]);
  assert.equal((await getDoc(doc(a.firestore, 'public_profiles', bUid))).exists(), true);
  assert.equal((await getDoc(doc(b.firestore, 'public_profiles', aUid))).exists(), true);

  const chatId = (await ensureChat({ otherUserUid: bUid })).data.chatId;
  assert.ok(chatId);
  await reconcile({ peerUid: bUid });
  const firstMessage = (await bSend({
    chatId, content: 'Mensagem antes do bloqueio',
    clientRequestId: randomUUID().replaceAll('-', ''),
  })).data.messageId;
  assert.ok(firstMessage);

  // One owner-scoped block collection watcher, not one watcher per card.
  const aOwnBlocks = observeOwnBlocks(a, aUid);
  const bOwnBlocks = observeOwnBlocks(b, bUid);
  const aChat = observeDocument(a, 'direct_chat_access/' + aUid + '/peers/' + bUid);
  const bChat = observeDocument(b, 'direct_chat_access/' + bUid + '/peers/' + aUid);
  const aMedia = observeDocument(a, 'public_media_access/' + aUid + '/owners/' + bUid);
  const bMedia = observeDocument(b, 'public_media_access/' + bUid + '/owners/' + aUid);
  await waitAvailable('chat A inicialmente liberado', aChat, true);
  await waitAvailable('chat B inicialmente liberado', bChat, true);
  await until('listas próprias iniciais', () =>
    [latest(aOwnBlocks), latest(bOwnBlocks)],
    ([left, right]) => Array.isArray(left) && left.length === 0
      && Array.isArray(right) && right.length === 0
  );

  assert.equal((await aBlock({ targetUid: bUid })).data.status, 'blocked');
  await waitAvailable('chat A revogado', aChat, false);
  await waitAvailable('chat B revogado', bChat, false);
  await waitAvailable('mídia A revogada', aMedia, false);
  await waitAvailable('mídia B revogada', bMedia, false);
  for (const state of [latest(aChat), latest(bChat), latest(aMedia), latest(bMedia)]) {
    for (const field of ['blockedByUid', 'actorUid', 'direction', 'reason']) {
      assert.equal(state[field], undefined, 'Projeção privada não expõe ' + field);
    }
  }
  await until('bloqueio próprio A no outro cliente', () => latest(aOwnBlocks),
    (value) => Array.isArray(value) && value.includes(bUid));
  assert.deepEqual(latest(bOwnBlocks), [], 'B não recebe a identidade de quem bloqueou');

  await expectDenied(
    () => getDoc(doc(b.firestore, 'users', aUid, 'blocks', bUid)),
    'permission-denied'
  );
  await expectDenied(
    () => getDoc(doc(b.firestore, 'public_profiles', aUid)),
    'permission-denied'
  );
  await expectDenied(
    () => getDoc(doc(a.firestore, 'public_profiles', bUid)),
    'permission-denied'
  );
  assert.deepEqual(await lookup(aDiscovery, bUid), []);
  assert.deepEqual(await lookup(bDiscovery, aUid), []);
  await expectDenied(() => bEnsureChat({ otherUserUid: aUid }), 'functions/permission-denied');
  await expectDenied(() => bSend({
    chatId, content: 'Não deve ser enviada',
    clientRequestId: randomUUID().replaceAll('-', ''),
  }), 'functions/permission-denied');
  assert.equal((await db.doc('chats/' + chatId + '/messages/' + firstMessage).get()).exists, true);

  // The other party's own block takes precedence over A's subsequent unblock.
  await bBlock({ targetUid: aUid });
  await aUnblock({ targetUid: bUid });
  await waitAvailable('chat A segue revogado pelo bloqueio inverso', aChat, false);
  await waitAvailable('chat B segue revogado pelo bloqueio inverso', bChat, false);
  await waitAvailable('mídia A segue revogada pelo bloqueio inverso', aMedia, false);
  await waitAvailable('mídia B segue revogada pelo bloqueio inverso', bMedia, false);
  assert.deepEqual(await lookup(aDiscovery, bUid), []);
  assert.deepEqual(await lookup(bDiscovery, aUid), []);

  await bUnblock({ targetUid: aUid });
  await waitAvailable('chat A restaurado', aChat, true);
  await waitAvailable('chat B restaurado', bChat, true);
  await waitAvailable('mídia A restaurada', aMedia, true);
  await waitAvailable('mídia B restaurada', bMedia, true);
  await until('listas de bloqueio limpas', () =>
    [latest(aOwnBlocks), latest(bOwnBlocks)],
    ([left, right]) => Array.isArray(left) && left.length === 0
      && Array.isArray(right) && right.length === 0
  );
  assert.deepEqual(await lookup(aDiscovery, bUid), [bUid]);
  assert.deepEqual(await lookup(bDiscovery, aUid), [aUid]);
  assert.equal((await getDoc(doc(b.firestore, 'public_profiles', aUid))).exists(), true);
  assert.equal((await getDoc(doc(a.firestore, 'public_profiles', bUid))).exists(), true);
  assert.equal((await db.doc('chats/' + chatId + '/messages/' + firstMessage).get()).exists, true);
  console.log('[bilateral-two-sessions:e2e] PASS auth isolation, Firestore Rules, discovery, chat, private projections and unblock.');
} finally {
  for (const stop of unsubscribe) stop();
  await Promise.allSettled(apps.map((app) => deleteApp(app)));
  await deleteAdminApp(admin);
}
