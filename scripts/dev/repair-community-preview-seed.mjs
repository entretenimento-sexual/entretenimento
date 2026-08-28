import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorHost) {
  console.error(
    '[repair:communities] Abortado: FIRESTORE_EMULATOR_HOST ausente.'
  );
  process.exit(1);
}

initializeApp({ projectId, credential: applicationDefault() });

const db = getFirestore();
const now = Date.now();
const seedOwnerUid = 'dev-community-seed-owner';
const seedMemberLimit = 1_000;
const seededCommunityIds = [
  'community-amizades-rio',
  'community-swing-rio',
  'community-bdsm-brasil',
  'community-casais-liberais',
  'community-tantra-conexao',
  'community-poliamor-brasil',
  'community-voyeurismo-exibicionismo',
  'community-pessoas-trans-aliados',
  'community-fetiches-sem-tabu',
  'community-ao-ar-livre',
  'community-zona-sul',
  'community-conexoes-discretas',
];

const communityRefs = seededCommunityIds.map((id) =>
  db.collection('communities').doc(id)
);
const discoveryRefs = seededCommunityIds.map((id) =>
  db.collection('community_discovery_index').doc(id)
);
const snapshots = await db.getAll(...communityRefs, ...discoveryRefs);
const communitySnapshots = snapshots.slice(0, communityRefs.length);
const discoverySnapshots = snapshots.slice(communityRefs.length);
const existingCommunityIds = communitySnapshots
  .filter((snapshot) => snapshot.exists)
  .map((snapshot) => snapshot.id);

if (existingCommunityIds.length === 0) {
  console.error(
    '[repair:communities] Nenhuma Comunidade do seed foi encontrada. Rode npm run seed:communities:emu primeiro.'
  );
  process.exit(1);
}

const batch = db.batch();

batch.set(
  db.collection('users').doc(seedOwnerUid),
  {
    uid: seedOwnerUid,
    role: 'admin',
    profileCompleted: true,
    emailVerified: true,
    updatedAt: now,
    devSeed: {
      scope: 'community-preview',
      technicalOwner: true,
    },
  },
  { merge: true }
);

for (let index = 0; index < communitySnapshots.length; index += 1) {
  const communitySnapshot = communitySnapshots[index];
  if (!communitySnapshot.exists) continue;

  batch.set(
    communitySnapshot.ref,
    {
      ownerUid: seedOwnerUid,
      createdBy: seedOwnerUid,
      capacity: {
        memberLimit: seedMemberLimit,
        policyVersion: 1,
      },
      updatedAt: now,
    },
    { merge: true }
  );

  const discoverySnapshot = discoverySnapshots[index];
  if (discoverySnapshot?.exists) {
    batch.set(
      discoverySnapshot.ref,
      {
        capacity: {
          memberLimit: seedMemberLimit,
          policyVersion: 1,
        },
        updatedAt: now,
      },
      { merge: true }
    );
  }
}

await batch.commit();

console.log(
  `[repair:communities] Projeto=${projectId} | Emulador=${emulatorHost}`
);
console.log(
  `[repair:communities] Proprietário técnico=${seedOwnerUid} | Comunidades reparadas=${existingCommunityIds.length}`
);
console.log(
  `[repair:communities] Capacidade explícita=${seedMemberLimit} | policyVersion=1`
);
