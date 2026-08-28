// scripts/dev/seed-room-access.mjs
// -----------------------------------------------------------------------------
// Concede acesso de plano a um usuario existente SOMENTE nos Emulators.
//
// Uso por e-mail (recomendado):
//   npm run seed:room-access:emu -- --email=usuario@teste.com --role=premium
//
// Uso por UID:
//   npm run seed:room-access:emu -- --uid=<UID_REAL> --role=premium
//
// O script atualiza o entitlement canonico e as projecoes usadas pela interface.
// Nao cria usuario, nao opera sem Firestore Emulator e nao aceita admin.
// -----------------------------------------------------------------------------

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const PLACEHOLDER_UIDS = new Set([
  'UID_DO_USUARIO',
  '<UID>',
  '<UID_REAL>',
]);
const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.split('=');
    return [key, value.join('=')];
  })
);

const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
let uid = String(options['--uid'] ?? process.env.ROOM_TEST_UID ?? '').trim();
const email = String(options['--email'] ?? process.env.ROOM_TEST_EMAIL ?? '')
  .trim()
  .toLowerCase();
const role = String(options['--role'] ?? 'premium').trim().toLowerCase();

if (!firestoreEmulatorHost) {
  console.error(
    '[seed:room-access] Abortado: FIRESTORE_EMULATOR_HOST ausente. ' +
      'Este script so pode escrever no emulador.'
  );
  process.exit(1);
}

if (PLACEHOLDER_UIDS.has(uid)) {
  console.error(
    '[seed:room-access] Substitua o UID de exemplo por um UID real ou use --email.'
  );
  process.exit(2);
}

if (!uid && !email) {
  console.error(
    '[seed:room-access] Informe --email=<EMAIL_DO_EMULADOR> ou --uid=<UID_REAL>.'
  );
  process.exit(2);
}

if (uid && (uid.length > 128 || uid.includes('/'))) {
  console.error('[seed:room-access] O UID informado e invalido.');
  process.exit(2);
}

if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('[seed:room-access] O e-mail informado e invalido.');
  process.exit(2);
}

if (!['basic', 'premium', 'vip'].includes(role)) {
  console.error('[seed:room-access] --role deve ser basic, premium ou vip.');
  process.exit(2);
}

initializeApp({
  projectId,
  credential: applicationDefault(),
});

if (!uid) {
  if (!authEmulatorHost) {
    console.error(
      '[seed:room-access] FIREBASE_AUTH_EMULATOR_HOST ausente para resolver --email.'
    );
    process.exit(1);
  }

  try {
    uid = (await getAuth().getUserByEmail(email)).uid;
  } catch (error) {
    console.error(
      `[seed:room-access] Usuario ${email} nao encontrado no Auth Emulator.`
    );
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(3);
  }
}

const db = getFirestore();
const now = Date.now();
const userRef = db.collection('users').doc(uid);
const publicProfileRef = db.collection('public_profiles').doc(uid);
const entitlementId = `platform_subscription_${uid}`;
const entitlementRef = db.collection('entitlements').doc(entitlementId);

const [userSnapshot, publicProfileSnapshot, entitlementSnapshot] =
  await Promise.all([
    userRef.get(),
    publicProfileRef.get(),
    entitlementRef.get(),
  ]);

if (!userSnapshot.exists) {
  console.error(
    `[seed:room-access] Abortado: users/${uid} nao existe no Firestore Emulator.`
  );
  process.exit(3);
}

const previousEntitlement = entitlementSnapshot.data() ?? {};
const batch = db.batch();

batch.set(
  entitlementRef,
  {
    id: entitlementId,
    buyerUid: uid,
    sellerUid: null,
    scope: 'platform_subscription',
    planId: `emulator-${role}`,
    planKey: role,
    grantedRole: role,
    active: true,
    startsAt:
      typeof previousEntitlement.startsAt === 'number'
        ? previousEntitlement.startsAt
        : now,
    endsAt: null,
    sourceCheckoutSessionId: `emulator-room-access-${uid}`,
    sourcePaymentTransactionId: `emulator-room-access-${uid}`,
    createdAt:
      typeof previousEntitlement.createdAt === 'number'
        ? previousEntitlement.createdAt
        : now,
    updatedAt: now,
  },
  { merge: true }
);

batch.set(
  userRef,
  {
    role,
    tier: role,
    isSubscriber: true,
    monthlyPayer: true,
    subscriptionStatus: 'active',
    subscriptionScope: 'platform_subscription',
    billingUpdatedAt: now,
  },
  { merge: true }
);

if (publicProfileSnapshot.exists) {
  batch.set(
    publicProfileRef,
    {
      role,
      updatedAt: now,
    },
    { merge: true }
  );
}

await batch.commit();

console.log(
  `[seed:room-access] Concluido | projeto=${projectId} | ` +
    `firestore=${firestoreEmulatorHost} | uid=${uid} | role=${role}`
);
