// scripts/dev/seed-room-access.mjs
// -----------------------------------------------------------------------------
// Concede acesso de plano a um usuário existente SOMENTE no Firestore Emulator.
//
// Uso:
//   npm run seed:room-access:emu -- --uid=<UID> --role=premium
//
// O script atualiza o entitlement canônico e as projeções usadas pela interface.
// Não cria usuário, não opera sem FIRESTORE_EMULATOR_HOST e não aceita admin.
// -----------------------------------------------------------------------------

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.split('=');
    return [key, value.join('=')];
  })
);

const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const uid = String(options['--uid'] ?? process.env.ROOM_TEST_UID ?? '').trim();
const role = String(options['--role'] ?? 'premium').trim().toLowerCase();

if (!emulatorHost) {
  console.error(
    '[seed:room-access] Abortado: FIRESTORE_EMULATOR_HOST ausente. ' +
      'Este script só pode escrever no emulador.'
  );
  process.exit(1);
}

if (!uid || uid.length > 128 || uid.includes('/')) {
  console.error('[seed:room-access] Informe um UID válido com --uid=<UID>.');
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
    `[seed:room-access] Abortado: users/${uid} não existe no emulador.`
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
  `[seed:room-access] Concluído | projeto=${projectId} | ` +
    `emulador=${emulatorHost} | uid=${uid} | role=${role}`
);
