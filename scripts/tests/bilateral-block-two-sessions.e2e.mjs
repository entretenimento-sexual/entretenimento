// Two isolated signed-in clients against REAL emulator Functions and Firestore Rules.
// Never connects to production or the developer's persistent emulator snapshot.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  connectStorageEmulator, getDownloadURL, getStorage, ref, uploadBytes,
} from 'firebase/storage';
import {
  getAuth, connectAuthEmulator, signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFunctions, connectFunctionsEmulator, httpsCallable,
} from 'firebase/functions';
import {
  getFirestore as getClientFirestore, connectFirestoreEmulator,
  collection, doc, getDoc, getDocFromServer, onSnapshot, query, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import {
  initializeApp as initializeAdminApp, deleteApp as deleteAdminApp,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { revokeAvatarTokens } from '../dev/revoke-legacy-avatar-tokens.mjs';
import { seedPublicMediaCompliance } from './media-e2e-compliance-fixture.mjs';
import { buildPreferenceDiscoveryProjection } from '../../src/app/preferences/utils/preference-discovery-projection.util.ts';

const sharp = createRequire(new URL('../../functions/package.json', import.meta.url))('sharp');
const PROJECT = 'demo-entretenimento-media-e2e';
const HOST = '127.0.0.1';
const AUTH_PORT = 19099;
const FIRESTORE_PORT = 18080;
const FUNCTIONS_PORT = 15001;
const STORAGE_PORT = 19199;
const BUCKET = PROJECT + '.appspot.com';
const DEADLINE_MS = 30_000;

assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, HOST + ':' + AUTH_PORT);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, HOST + ':' + FIRESTORE_PORT);
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, HOST + ':' + STORAGE_PORT);
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
    storageBucket: BUCKET,
  }, 'bilateral-' + name + '-' + id);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://' + HOST + ':' + AUTH_PORT, {
    disableWarnings: true,
  });
  const functions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(functions, HOST, FUNCTIONS_PORT);
  const firestore = getClientFirestore(app);
  connectFirestoreEmulator(firestore, HOST, FIRESTORE_PORT);
  const storage = getStorage(app);
  connectStorageEmulator(storage, HOST, STORAGE_PORT);
  apps.push(app);
  return { auth, functions, firestore, storage };
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

const admin = initializeAdminApp({ projectId: PROJECT, storageBucket: BUCKET }, 'bilateral-admin-' + id);
const adminAuth = getAdminAuth(admin);
const db = getAdminFirestore(admin);
const bucket = getAdminStorage(admin).bucket();
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

  const jpeg = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#497da8' },
  }).jpeg().toBuffer();
  const avatarPaths = new Map();
  const readAvatar = (client, uid) =>
    httpsCallable(client.functions, 'getProfileAvatar')({ storagePath: avatarPaths.get(uid) });
  for (const [client, uid, other] of [[a, aUid, b], [b, bUid, a]]) {
    const staging = `users/${uid}/uploads/avatar/media-101-${id}.jpg`;
    await uploadBytes(ref(client.storage, staging), jpeg, { contentType: 'image/jpeg' });
    const publish = httpsCallable(client.functions, 'finalizeProfileAvatar');
    await expectDenied(
      () => httpsCallable(other.functions, 'finalizeProfileAvatar')({ storagePath: staging }),
      'functions/invalid-argument'
    );
    const { avatarReference } = (await publish({ storagePath: staging })).data;
    assert.equal((await publish({ storagePath: staging })).data.avatarReference, avatarReference);
    const reference = new URL(avatarReference);
    assert.equal(reference.search, '', 'O perfil guarda só a referência ao objeto');
    const path = decodeURIComponent(reference.pathname.split('/o/')[1]);
    avatarPaths.set(uid, path);
    assert.equal((await bucket.file(staging).exists())[0], false);
    const [metadata] = await bucket.file(path).getMetadata();
    assert.equal(metadata.metadata?.firebaseStorageDownloadTokens, undefined);
    await expectDenied(() => getDownloadURL(ref(client.storage, path)), 'storage/unauthorized');
    await expectDenied(() => getDownloadURL(ref(other.storage, path)), 'storage/unauthorized');
    await expectDenied(() =>
      uploadBytes(ref(client.storage, path), jpeg, { contentType: 'image/jpeg' }),
    'storage/unauthorized');
    assert.equal((await sharp(Buffer.from((await readAvatar(other, uid)).data.image, 'base64')).metadata()).format, 'webp');
  }

  const legacy = bucket.file(`users/${aUid}/published/avatar/avatar-101.jpg`);
  const legacyToken = randomUUID();
  await legacy.save(jpeg, {
    resumable: false,
    metadata: {
      contentType: 'image/jpeg',
      metadata: { firebaseStorageDownloadTokens: legacyToken },
    },
  });
  const storageOrigin = `http://${HOST}:${STORAGE_PORT}`;
  const [legacyMetadata] = await legacy.getMetadata();
  await revokeAvatarTokens(storageOrigin, legacy, legacyMetadata);
  const oldLink = new URL(`/v0/b/${BUCKET}/o/${encodeURIComponent(legacy.name)}`, storageOrigin);
  oldLink.searchParams.set('alt', 'media');
  oldLink.searchParams.set('token', legacyToken);
  const revoked = await fetch(oldLink);
  assert.equal(revoked.status, 403, 'O link antigo fica indisponível.');
  await revoked.body?.cancel();
  const legacyAvatar = await httpsCallable(b.functions, 'getProfileAvatar')({ storagePath: legacy.name });
  assert.ok(legacyAvatar.data.image, 'A mesma foto legada continua disponível no fluxo protegido.');

  const aDiscovery = httpsCallable(a.functions, 'getPublicProfilesPage');
  const bDiscovery = httpsCallable(b.functions, 'getPublicProfilesPage');
  const ensureChat = httpsCallable(a.functions, 'ensureDirectChat');
  const getStarter = httpsCallable(a.functions, 'getDirectConversationStarter');
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
  assert.deepEqual((await getStarter({ chatId })).data, { pace: null });
  const aPreferences = doc(a.firestore, 'users', aUid, 'preferences', 'profile');
  const bPreferences = doc(b.firestore, 'users', bUid, 'preferences', 'profile');
  const paceProfile = (userId, conversationPace) => ({
    userId, conversationPace, relationshipIntents: [],
    hardRules: {
      acceptedGenders: [], acceptedRelationshipIntents: [], ageRange: null, maxDistanceKm: null,
      acceptsCouples: true, acceptsSingles: true, acceptsTransProfiles: null, locationRequired: false,
    },
    softRules: { bodyPreferences: [], sexualPractices: [] },
    selfTraits: { bodyTraits: [] },
    visibility: { discoveryMode: 'standard', showPreferenceBadges: true, shareConversationPace: true },
    updatedAt: Date.now(),
  });
  await expectDenied(
    () => updateDoc(doc(a.firestore, 'users', aUid), { showOrientationPublicly: true }),
    'permission-denied'
  );
  await setDoc(aPreferences, paceProfile(aUid, 'talk_first'));
  assert.deepEqual((await getStarter({ chatId })).data, { pace: null });
  await setDoc(bPreferences, paceProfile(bUid, 'take_it_slow'));
  assert.deepEqual((await getStarter({ chatId })).data, { pace: null });
  await expectDenied(() => updateDoc(bPreferences, { conversationPace: 'unrecognized' }), 'permission-denied');
  await expectDenied(
    () => getDoc(doc(a.firestore, 'users', bUid, 'preferences', 'profile')),
    'permission-denied'
  );
  await updateDoc(bPreferences, { conversationPace: 'talk_first' });
  assert.deepEqual((await getStarter({ chatId })).data, { pace: 'talk_first' });
  await updateDoc(bPreferences, { 'visibility.shareConversationPace': false });
  assert.deepEqual((await getStarter({ chatId })).data, { pace: null });
  await updateDoc(bPreferences, { 'visibility.shareConversationPace': true });
  console.log('[bilateral-two-sessions:e2e] PASS private pace, mutual suggestion and consent revocation');

  const neutralUid = 'bilateral-neutral-' + id;
  await seedPublicMediaCompliance(db, [neutralUid]);
  await Promise.all([
    ...[aUid, bUid, neutralUid].map((uid) => db.doc('users/' + uid).set({
      identityCode: 'mulher', orientation: 'bissexual',
    }, { merge: true })),
    db.doc('public_profiles/' + neutralUid).set({
      ...profile(neutralUid), updatedAt: new Date(Date.now() + 10_000),
    }),
    updateDoc(aPreferences, { 'softRules.intimateInterests': { impact_play: 'explore' } }),
    updateDoc(bPreferences, { 'softRules.intimateInterests': { impact_play: 'familiar' } }),
  ]);
  const listWithSuggestions = async () => (await aDiscovery({
    suggestByIntimateInterests: true, pageSize: 24,
  })).data;
  assert.equal((await listWithSuggestions()).suggestedOrder, undefined);
  await updateDoc(aPreferences, { 'visibility.useIntimateInterestsInSuggestions': true });
  assert.equal((await listWithSuggestions()).suggestedOrder, undefined);
  await updateDoc(bPreferences, { 'visibility.useIntimateInterestsInSuggestions': true });
  const suggested = await listWithSuggestions();
  const listed = suggested.items.map(({ uid }) => uid);
  assert.ok(listed.indexOf(neutralUid) >= 0 && listed.indexOf(neutralUid) < listed.indexOf(bUid));
  assert.deepEqual(suggested.suggestedOrder, [bUid, neutralUid]);
  assert.equal(JSON.stringify(suggested).includes('impact_play'), false);
  assert.equal(JSON.stringify(suggested).includes('useIntimateInterestsInSuggestions'), false);
  assert.equal((await aDiscovery({ uids: [bUid, neutralUid], suggestByIntimateInterests: true })).data.suggestedOrder, undefined);
  await updateDoc(bPreferences, { 'visibility.useIntimateInterestsInSuggestions': false });
  assert.equal((await listWithSuggestions()).suggestedOrder, undefined);
  console.log('[bilateral-two-sessions:e2e] PASS private discovery suggestions and consent revocation');

  async function saveProfileType(client, uid, genderInterest) {
    const saved = paceProfile(uid, 'talk_first');
    saved.hardRules.acceptedGenders = [genderInterest];
    const projection = buildPreferenceDiscoveryProjection(saved);
    const batch = writeBatch(client.firestore);
    batch.set(doc(client.firestore, 'users', uid, 'preferences', 'profile'), saved);
    batch.set(doc(client.firestore, 'users', uid), {
      ...projection,
      discoveryPreferencesUpdatedAt: saved.updatedAt,
    }, { merge: true });
    await batch.commit();
  }

  await saveProfileType(b, bUid, 'drag_king');
  const backwards = (await bDiscovery({ uids: [aUid] })).data;
  for (const [response, uid] of [
    [await listWithSuggestions(), bUid],
    [(await aDiscovery({ uids: [bUid] })).data, bUid],
    [backwards, aUid],
  ]) {
    const target = response.items.find((item) => item.uid === uid);
    assert.equal(target?.viewerCompatibilityAllowed, false);
    assert.equal(target?.viewerCompatibilityReason, 'incompatible');
    assert.equal(Object.hasOwn(target, 'discoveryPreferences'), false);
    assert.equal(Object.hasOwn(target, 'interestedInGenders'), false);
  }
  console.log('[bilateral-two-sessions:e2e] PASS exact reciprocal preference in both directions');

  await reconcile({ peerUid: bUid });
  const firstMessage = (await bSend({
    chatId, content: 'Mensagem antes do bloqueio',
    clientRequestId: randomUUID().replaceAll('-', ''),
  })).data.messageId;
  assert.ok(firstMessage);

  const aMessage = doc(a.firestore, 'chats', chatId, 'messages', firstMessage);
  const aUser = a.auth.currentUser;
  await adminAuth.updateUser(aUid, { emailVerified: false });
  await aUser.reload();
  assert.equal((await aUser.getIdTokenResult(true)).claims.email_verified, false);
  await expectDenied(() => getDocFromServer(aMessage), 'permission-denied');
  await expectDenied(() => updateDoc(aMessage, { status: 'delivered' }), 'permission-denied');
  await expectDenied(() => reconcile({ peerUid: bUid }), 'functions/failed-precondition');
  await expectDenied(() => getStarter({ chatId }), 'functions/failed-precondition');

  await adminAuth.updateUser(aUid, { emailVerified: true });
  await aUser.reload();
  assert.equal((await aUser.getIdTokenResult(true)).claims.email_verified, true);
  assert.equal((await getDocFromServer(aMessage)).exists(), true);
  await updateDoc(aMessage, { status: 'delivered' });
  console.log('[bilateral-two-sessions:e2e] PASS chat authorization follows the refreshed Auth token');

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
  await expectDenied(() => readAvatar(a, bUid), 'functions/not-found');
  await expectDenied(() => readAvatar(b, aUid), 'functions/not-found');
  assert.ok((await readAvatar(a, aUid)).data.image, 'O titular ainda vê o próprio avatar.');
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
  await expectDenied(() => getStarter({ chatId }), 'functions/permission-denied');
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
  await expectDenied(() => readAvatar(a, bUid), 'functions/not-found');
  await expectDenied(() => readAvatar(b, aUid), 'functions/not-found');
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
  assert.ok((await readAvatar(b, aUid)).data.image);
  await db.doc('users/' + aUid).set({ publicVisibility: 'hidden' }, { merge: true });
  await expectDenied(() => readAvatar(b, aUid), 'functions/not-found');
  await db.doc('users/' + aUid).set({ publicVisibility: 'visible', suspended: true }, { merge: true });
  await expectDenied(() => readAvatar(b, aUid), 'functions/not-found');
  console.log('[bilateral-two-sessions:e2e] PASS avatars, auth isolation, Firestore Rules, discovery, chat, private projections and unblock.');

  const profileTypes = new Map([
    ['men', 'homem'], ['women', 'mulher'], ['travestis', 'travesti'],
    ['trans_people', 'transexual'], ['crossdressers', 'crossdressers'],
    ['couple_mm', 'casal-ele-ele'], ['couple_mf', 'casal-ele-ela'], ['couple_ff', 'casal-ela-ela'],
    ['non_binary', 'nao-binario'], ['intersex', 'intersexo'], ['drag_queen', 'drag-queen'],
    ['drag_king', 'drag-king'], ['genderfluid', 'genero-fluido'], ['agender', 'agenero'],
    ['genderqueer', 'genero-queer'], ['androgynous', 'androgino'],
  ]);
  const matrixViewer = makeClient('profile-types');
  const matrixViewerUid = 'profile-types-viewer-' + id;
  const candidates = new Map([...profileTypes.keys()].map((key) => [key, `profile-type-${key}-${id}`]));
  const candidateUids = new Set(candidates.values());
  await adminAuth.createUser({
    uid: matrixViewerUid, email: matrixViewerUid + '@example.test', password, emailVerified: true,
  });
  await seedPublicMediaCompliance(db, [matrixViewerUid, ...candidateUids]);
  await db.doc('users/' + matrixViewerUid).set({
    gender: 'mulher', emailVerified: true, loginAllowed: true,
  }, { merge: true });

  await Promise.all([...profileTypes].map(async ([key, code]) => {
    const uid = candidates.get(key);
    const nickname = 'Perfil ' + key;
    await db.doc('public_profiles/' + uid).set({ ...profile(uid), nickname });
    await db.doc('users/' + uid).set({
      gender: code, declaredIdentityCode: code, nickname, nicknameNormalized: nickname.toLowerCase(),
    }, { merge: true });
  }));
  await until('projeções públicas dos tipos de perfil', async () => {
    const snapshots = await db.getAll(...[...candidateUids].map((uid) => db.doc('public_profiles/' + uid)));
    return snapshots.filter((entry) => entry.exists && entry.data().identityLabel).length;
  }, (count) => count === candidates.size);

  await signInWithEmailAndPassword(matrixViewer.auth, matrixViewerUid + '@example.test', password);
  const discoverTypes = httpsCallable(matrixViewer.functions, 'getPublicProfilesPage');
  for (const key of profileTypes.keys()) {
    await saveProfileType(matrixViewer, matrixViewerUid, key);
    const { items } = (await discoverTypes({ pageSize: 24 })).data;
    const cards = items.filter(({ uid }) => candidateUids.has(uid));
    assert.equal(cards.length, candidateUids.size, key);
    assert.deepEqual(
      cards.filter(({ viewerCompatibilityAllowed }) => viewerCompatibilityAllowed).map(({ uid }) => uid),
      [candidates.get(key)],
      key
    );
  }
  console.log('[bilateral-two-sessions:e2e] PASS all 16 exact profile choices, including three couple compositions.');
} finally {
  for (const stop of unsubscribe) stop();
  await Promise.allSettled(apps.map((app) => deleteApp(app)));
  await deleteAdminApp(admin);
}
