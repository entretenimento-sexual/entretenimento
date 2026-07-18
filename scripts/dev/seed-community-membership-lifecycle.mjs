// scripts/dev/seed-community-membership-lifecycle.mjs
// -----------------------------------------------------------------------------
// SEED DEV/EMULATOR - COMMUNITY MEMBERSHIP LIFECYCLE
// -----------------------------------------------------------------------------
// - exige Firestore Emulator;
// - exige COMMUNITY_MODERATOR_UID explícito;
// - promove somente esse UID como moderador da comunidade fictícia;
// - cria duas solicitações pendentes com IDs reservados ao seed;
// - não cria usuários no Auth Emulator;
// - não grava coordenadas, mídia ou dados financeiros;
// - usa merge e não altera documentos de usuários reais.
// -----------------------------------------------------------------------------

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const moderatorUid = String(process.env.COMMUNITY_MODERATOR_UID ?? '').trim();
const communityId = 'community-rj-centro';

if (!emulatorHost) {
  console.error(
    '[seed:community-memberships] Abortado: FIRESTORE_EMULATOR_HOST ausente.'
  );
  process.exit(1);
}

if (!SAFE_ID_PATTERN.test(moderatorUid)) {
  console.error(
    '[seed:community-memberships] Abortado: defina COMMUNITY_MODERATOR_UID com o UID do usuário autenticado no Auth Emulator.'
  );
  process.exit(1);
}

const pendingUsers = [
  {
    uid: 'community-pending-alfa',
    nickname: 'Pessoa Alfa',
    requestedOffsetMs: 12 * 60_000,
  },
  {
    uid: 'community-pending-beta',
    nickname: 'Pessoa Beta',
    requestedOffsetMs: 37 * 60_000,
  },
];

if (pendingUsers.some((user) => user.uid === moderatorUid)) {
  console.error(
    '[seed:community-memberships] Abortado: o UID moderador não pode usar um ID reservado ao seed.'
  );
  process.exit(1);
}

initializeApp({ projectId, credential: applicationDefault() });

const db = getFirestore();
const now = Date.now();
const communityRef = db.collection('communities').doc(communityId);
const communitySnapshot = await communityRef.get();

if (!communitySnapshot.exists) {
  console.error(
    `[seed:community-memberships] Abortado: communities/${communityId} ausente. Execute primeiro npm.cmd run seed:communities:emu.`
  );
  process.exit(1);
}

const batch = db.batch();
const moderatorMembershipRef = communityRef.collection('members').doc(moderatorUid);

batch.set(
  moderatorMembershipRef,
  {
    communityId,
    uid: moderatorUid,
    role: 'moderator',
    status: 'active',
    requestedAt: null,
    joinedAt: now,
    leftAt: null,
    reviewedAt: null,
    reviewedBy: null,
    requestResolution: null,
    updatedAt: now,
    policyVersion: 1,
    source: 'emulator-seed',
  },
  { merge: true }
);

for (const user of pendingUsers) {
  const userRef = db.collection('users').doc(user.uid);
  const membershipRef = communityRef.collection('members').doc(user.uid);

  batch.set(
    userRef,
    {
      uid: user.uid,
      nickname: user.nickname,
      nome: user.nickname,
      photoURL: null,
      updatedAt: now,
      source: 'emulator-seed',
    },
    { merge: true }
  );

  batch.set(
    membershipRef,
    {
      communityId,
      uid: user.uid,
      role: 'member',
      status: 'pending',
      requestedAt: now - user.requestedOffsetMs,
      joinedAt: null,
      leftAt: null,
      reviewedAt: null,
      reviewedBy: null,
      requestResolution: null,
      updatedAt: now,
      policyVersion: 1,
      source: 'emulator-seed',
    },
    { merge: true }
  );
}

await batch.commit();

console.log(
  `[seed:community-memberships] Projeto=${projectId} | Emulador=${emulatorHost}`
);
console.log(
  `[seed:community-memberships] Moderador=${moderatorUid} | Comunidade=${communityId}`
);
console.log(
  `[seed:community-memberships] Solicitações pendentes=${pendingUsers.length}`
);
console.log('[seed:community-memberships] Concluído sem limpar dados existentes.');
