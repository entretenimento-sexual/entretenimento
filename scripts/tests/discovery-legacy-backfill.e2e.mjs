import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore as clientFirestore, connectFirestoreEmulator, doc, getDoc } from 'firebase/firestore';
import { initializeApp as adminApp, deleteApp as deleteAdminApp, applicationDefault } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const project = 'demo-entretenimento-media-e2e';
const host = '127.0.0.1';
assert.match(project, /^demo-/);
assert.ok(process.env.FIREBASE_EMULATOR_HUB, 'É obrigatório iniciar via emulators:exec');
assert.match(
  String(process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? ''),
  /^(?:localhost|127\.0\.0\.1):19199$/,
  'Storage Emulator precisa estar ativo em localhost:19199 antes de executar o fixture'
);
process.env.GCLOUD_PROJECT = project;
process.env.GCP_PROJECT = project;
process.env.FIREBASE_AUTH_EMULATOR_HOST = host + ':19099';
process.env.FIRESTORE_EMULATOR_HOST = host + ':18080';

const tag = randomUUID().slice(0, 8);
const ids = ['aa-legacy-', 'ab-clean-', 'zy-admin-', 'zz-visitor-'].map(p => p + tag);
const [legacy, clean, operator, visitor] = ids;
const admin = adminApp({ projectId: project, credential: applicationDefault() }, 'discovery-backfill-' + tag);
const db = getFirestore(admin);
const auth = adminAuth(admin);
const clients = [];
const privateKeys = ['preferences','preferencias','interests','interesses','lookingFor','buscando',
  'discoveryPreferences','hardRules','softRules','matchingModes','selfTraits',
  'interestedInGenders','interestedInGender','targetGenders','preferredGenders',
  'generosDeInteresse','interestedInOrientations','interestedInOrientation',
  'targetOrientations','preferredOrientations','orientacoesDeInteresse'];

function client(uid) {
  const app = initializeApp({ apiKey: 'fake-key', projectId: project, authDomain: project + '.firebaseapp.com' }, uid);
  const a = getAuth(app);
  connectAuthEmulator(a, 'http://' + host + ':19099', { disableWarnings: true });
  const f = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(f, host, 15001);
  const store = clientFirestore(app);
  connectFirestoreEmulator(store, host, 18080);
  clients.push(app);
  return { app, auth: a, functions: f, store };
}
const ownerData = uid => ({ uid, role:'free', tier:'free', accountStatus:'active',
  emailVerified:true, profileCompleted:true, publicVisibility:'visible',
  interactionBlocked:false, loginAllowed:true, suspended:false,
  gender:'mulher', declaredIdentityCode:'mulher', identityCatalogVersion:1,
  acceptedTerms:{ accepted:true, version:'v3', acknowledgedPrivacyNotice:true },
  initialAdultConsentRequired:true, adultConsent:{ accepted:true, version:'v1' },
  ageReverification:{ status:'NONE' } });
const publicData = uid => ({ uid, nickname:'Perfil-' + uid, nicknameNormalized:'perfil-' + uid,
  gender:'mulher', identityCode:'mulher', identityCatalogVersion:1,
  orientation:'bissexual', role:'free', estado:'RJ', municipio:'Rio de Janeiro',
  createdAt:new Date(), updatedAt:new Date() });

async function untilDiscoveryTriggersSettled() {
  // Cada atualização gerada por trigger reinicia a janela de estabilidade.
  // Só injetar dados legados quando o estado inicial tiver sido normalizado
  // e as escritas de users/public_profiles estiverem estáveis.
  const deadline = Date.now() + 45_000;
  const stableWindowMs = 1_500;
  let pending = ids;
  let stableSince = 0;
  let lastVersion = '';
  while (Date.now() < deadline) {
    const [users, profiles] = await Promise.all([
      Promise.all(ids.map(uid => db.doc('users/' + uid).get())),
      Promise.all([legacy, clean].map(uid => db.doc('public_profiles/' + uid).get())),
    ]);
    pending = ids.filter((_, index) =>
      typeof users[index].get('profileId') !== 'string'
    );
    const projected = profiles.every(snapshot => snapshot.get('discoveryNormalizedAt'));
    const version = [...users, ...profiles].map(snapshot => {
      const timestamp = snapshot.updateTime;
      return timestamp ? timestamp.seconds + ':' + timestamp.nanoseconds : 'missing';
    }).join('|');
    if (pending.length === 0 && projected) {
      if (version !== lastVersion) {
        lastVersion = version;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= stableWindowMs) {
        return;
      }
    } else {
      lastVersion = '';
      stableSince = 0;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(
    'Sincronização inicial do fixture incompleta ou instável: ' + pending.length
    + ' profileIds pendentes e/ou projeções sem discoveryNormalizedAt.'
  );
}
async function denied(promise) {
  await assert.rejects(promise, error => error.code === 'permission-denied');
}

try {
  const password = 'Only-Emulator-Pass123!';
  for (const uid of [operator, visitor]) await auth.createUser({
    uid, email: uid + '@example.test', password, emailVerified:true,
  });
  await auth.setCustomUserClaims(operator, { admin:true });
  const op = client(operator), view = client(visitor);
  // Criar projeções limpas antes de users/ faz o trigger completar sua
  // primeira sincronização antes da contaminação legada simulada.
  await Promise.all([
    db.doc('public_profiles/' + legacy).set(publicData(legacy)),
    db.doc('public_profiles/' + clean).set(publicData(clean)),
  ]);
  const batch = db.batch();
  for (const uid of ids) batch.set(db.doc('users/' + uid), {
    ...ownerData(uid),
    ...(uid === operator ? { admin:true } : {}),
    ...(uid === legacy ? { interestedInGenders:['man'],
      interestedInOrientations:['heterosexual'], discoveryPreferences:{ genderInterests:['men'] } } : {}),
  });
  await batch.commit();
  await untilDiscoveryTriggersSettled();
  await Promise.all([
    signInWithEmailAndPassword(op.auth, operator + '@example.test', password),
    signInWithEmailAndPassword(view.auth, visitor + '@example.test', password),
  ]);
  await op.auth.currentUser.getIdToken(true);

  // A escrita abaixo NÃO altera users/: não existe gatilho legítimo pendente
  // de saneamento ao executar a callable administrativa em dryRun.
  await db.doc('public_profiles/' + legacy).set({
    interestedInGenders:['man'],
    discoveryPreferences:{ genderInterests:['men'] },
    hardRules:{ acceptedGenders:['men'] },
  }, { merge:true });
  const ref = db.doc('public_profiles/' + legacy);
  const initial = (await ref.get()).data();
  assert.ok(initial.interestedInGenders, 'Fixture legado precisa conter dados privados');
  await denied(getDoc(doc(view.store, 'public_profiles', legacy)));
  assert.equal((await getDoc(doc(view.store, 'public_profiles', clean))).exists(), true);

  const callable = httpsCallable(op.functions, 'backfillPublicProfileDiscovery');
  const blocked = httpsCallable(view.functions, 'backfillPublicProfileDiscovery');
  await assert.rejects(blocked({ limit:1, dryRun:false }),
    error => error.code === 'functions/permission-denied');

  const preview = (await callable({ limit:1 })).data;
  assert.equal(preview.dryRun, true);
  assert.deepEqual((await ref.get()).data(), initial);

  let cursor = null;
  for (let page = 0; page < 5; page += 1) {
    const result = (await callable({ limit:1, dryRun:false, startAfterUid:cursor })).data;
    assert.equal(result.dryRun, false);
    assert.ok(result.processed <= 1);
    if (!result.hasMore) { cursor = null; break; }
    assert.notEqual(result.nextCursor, cursor);
    cursor = result.nextCursor;
  }
  assert.equal(cursor, null, 'Backfill paginado não finalizou');
  const published = (await ref.get()).data();
  for (const key of privateKeys) assert.equal(Object.hasOwn(published, key), false, key);
  assert.ok(typeof published.profileId === 'string');
  const original = (await db.doc('users/' + legacy).get()).data();
  assert.deepEqual(original.interestedInGenders, ['man']);
  assert.deepEqual(original.discoveryPreferences, { genderInterests:['men'] });
  assert.equal((await getDoc(doc(view.store, 'public_profiles', legacy))).exists(), true);
  console.log('[discovery-backfill] OK dryRun, autorização, cursor, saneamento, leitura');
} finally {
  await Promise.allSettled(clients.map(app => deleteApp(app)));
  await deleteAdminApp(admin);
}
