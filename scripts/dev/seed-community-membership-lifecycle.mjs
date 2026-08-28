// scripts/dev/seed-community-membership-lifecycle.mjs
// -----------------------------------------------------------------------------
// SEED DEV/EMULATOR - COMMUNITY MEMBERSHIP LIFECYCLE
// -----------------------------------------------------------------------------
// - exige Firestore Emulator e Auth Emulator;
// - aceita COMMUNITY_MANAGER_EMAIL/UID e preserva COMMUNITY_MODERATOR_EMAIL/UID
//   como aliases compatíveis com o fluxo anterior;
// - aceita COMMUNITY_MANAGER_ROLE=moderator|admin|owner (moderator por padrão);
// - detecta automaticamente a conta gestora quando existir exatamente uma conta
//   ativa com e-mail verificado no Auth Emulator;
// - exige e-mail verificado para reproduzir o contrato das callables;
// - promove somente essa conta real ao papel de gestão solicitado;
// - usa uma Comunidade com entrada por aprovação para manter pendências coerentes;
// - cria solicitações, Admin, Moderador, Membro e bloqueados com IDs reservados;
// - restaura a métrica de membros do cenário-base para que ações anteriores não
//   contaminem execuções subsequentes do seed;
// - normaliza apenas atores de gestão criados por este próprio cenário;
// - não cria usuários no Auth Emulator;
// - não grava coordenadas, mídia ou dados financeiros;
// - usa merge e não altera perfis de usuários reais.
// -----------------------------------------------------------------------------

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const PLACEHOLDER_UID_PATTERN = /^(?:UID_REAL_DO_AUTH_EMULATOR|COLE_AQUI(?:_O)?_UID_REAL|SEU_UID|PLACEHOLDER)$/i;
const MANAGER_ROLES = new Set(['moderator', 'admin', 'owner']);
const SEED_MANAGER_MARKER = 'community-membership-lifecycle-manager';
const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const explicitManagerUid = String(
  process.env.COMMUNITY_MANAGER_UID
  ?? process.env.COMMUNITY_MODERATOR_UID
  ?? ''
).trim();
const managerEmail = String(
  process.env.COMMUNITY_MANAGER_EMAIL
  ?? process.env.COMMUNITY_MODERATOR_EMAIL
  ?? ''
).trim().toLowerCase();
const managerRole = String(
  process.env.COMMUNITY_MANAGER_ROLE ?? 'moderator'
).trim().toLowerCase();
const communityId = 'community-bdsm-brasil';
// Deve permanecer alinhado ao fixture homônimo em seed-community-preview.mjs.
// A coleção de memberships do seed não representa todos os participantes
// fictícios exibidos no card, portanto não é correto recalcular esse total por
// contagem de documentos.
const COMMUNITY_PREVIEW_BASELINE_MEMBER_COUNT = 738;

if (!emulatorHost) {
  console.error(
    '[seed:community-memberships] Abortado: FIRESTORE_EMULATOR_HOST ausente.'
  );
  process.exit(1);
}

if (!authEmulatorHost) {
  console.error(
    '[seed:community-memberships] Abortado: FIREBASE_AUTH_EMULATOR_HOST ausente.'
  );
  process.exit(1);
}

if (!MANAGER_ROLES.has(managerRole)) {
  console.error(
    `[seed:community-memberships] Abortado: COMMUNITY_MANAGER_ROLE=${managerRole || '(vazio)'} inválido. Use moderator, admin ou owner.`
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

const managedUserSeeds = [
  {
    uid: 'community-active-admin',
    nickname: 'Admin Seed',
    status: 'active',
    role: 'admin',
    joinedOffsetMs: 14 * 24 * 60 * 60_000,
  },
  {
    uid: 'community-active-moderator',
    nickname: 'Moderador Seed',
    status: 'active',
    role: 'moderator',
    joinedOffsetMs: 9 * 24 * 60 * 60_000,
  },
  {
    uid: 'community-active-member',
    nickname: 'Membro Seed',
    status: 'active',
    role: 'member',
    joinedOffsetMs: 5 * 24 * 60 * 60_000,
  },
  {
    uid: 'community-blocked-member',
    nickname: 'Bloqueado pelo Gestor',
    status: 'blocked',
    role: 'member',
    roleBeforeBlock: 'member',
    joinedOffsetMs: 10 * 24 * 60 * 60_000,
    blockedOffsetMs: 2 * 24 * 60 * 60_000,
  },
  {
    uid: 'community-blocked-admin',
    nickname: 'Ex Admin Bloqueado',
    status: 'blocked',
    role: 'member',
    roleBeforeBlock: 'admin',
    blockedBy: 'community-owner-seed',
    blockedByRole: 'owner',
    joinedOffsetMs: 20 * 24 * 60 * 60_000,
    blockedOffsetMs: 4 * 24 * 60 * 60_000,
  },
];

const reservedUids = [
  ...pendingUsers.map((user) => user.uid),
  ...managedUserSeeds.map((user) => user.uid),
];

initializeApp({ projectId, credential: applicationDefault() });

const auth = getAuth();

async function listAllAuthUsers() {
  const users = [];
  let pageToken;

  do {
    const page = await auth.listUsers(1_000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  return users;
}

async function resolveManagerUser() {
  if (explicitManagerUid) {
    if (
      !SAFE_ID_PATTERN.test(explicitManagerUid)
      || PLACEHOLDER_UID_PATTERN.test(explicitManagerUid)
    ) {
      console.error(
        '[seed:community-memberships] Abortado: COMMUNITY_MANAGER_UID/COMMUNITY_MODERATOR_UID inválido.'
      );
      process.exit(1);
    }

    try {
      return await auth.getUser(explicitManagerUid);
    } catch (error) {
      console.error(
        `[seed:community-memberships] Abortado: o UID ${explicitManagerUid} não existe no Auth Emulator.`,
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  }

  if (managerEmail) {
    try {
      return await auth.getUserByEmail(managerEmail);
    } catch (error) {
      console.error(
        `[seed:community-memberships] Abortado: o e-mail ${managerEmail} não existe no Auth Emulator.`,
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  }

  let users;
  try {
    users = await listAllAuthUsers();
  } catch (error) {
    console.error(
      '[seed:community-memberships] Abortado: não foi possível listar as contas do Auth Emulator.',
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }

  const eligibleUsers = users.filter(
    (user) =>
      user.emailVerified
      && !user.disabled
      && SAFE_ID_PATTERN.test(user.uid)
      && !reservedUids.includes(user.uid)
  );

  if (eligibleUsers.length === 1) {
    const [user] = eligibleUsers;
    console.log(
      `[seed:community-memberships] Conta gestora detectada automaticamente: ${user.email ?? user.uid}.`
    );
    return user;
  }

  if (eligibleUsers.length === 0) {
    console.error(
      '[seed:community-memberships] Abortado: nenhuma conta ativa com e-mail verificado foi encontrada no Auth Emulator.'
    );
    console.error(
      '[seed:community-memberships] Entre no app com uma conta de teste verificada e execute o seed novamente.'
    );
    process.exit(1);
  }

  console.error(
    `[seed:community-memberships] Abortado: ${eligibleUsers.length} contas verificadas estão elegíveis no Auth Emulator.`
  );
  console.error(
    '[seed:community-memberships] Defina COMMUNITY_MANAGER_EMAIL (ou COMMUNITY_MODERATOR_EMAIL legado) com o e-mail da conta usada no app.'
  );
  console.error(
    `[seed:community-memberships] Contas elegíveis: ${eligibleUsers
      .map((user) => user.email ?? user.uid)
      .join(', ')}`
  );
  process.exit(1);
}

const managerUser = await resolveManagerUser();
const managerUid = managerUser.uid;

if (
  !SAFE_ID_PATTERN.test(managerUid)
  || reservedUids.includes(managerUid)
) {
  console.error(
    '[seed:community-memberships] Abortado: a conta gestora resolveu para um UID inválido ou reservado ao seed.'
  );
  process.exit(1);
}

if (!managerUser.emailVerified || managerUser.disabled) {
  console.error(
    '[seed:community-memberships] Abortado: a conta gestora precisa estar ativa e com e-mail verificado no Auth Emulator.'
  );
  process.exit(1);
}

const managedUsers = managedUserSeeds.map((user) =>
  user.uid === 'community-blocked-member'
    ? {
        ...user,
        blockedBy: managerUid,
        blockedByRole: managerRole,
      }
    : user
);

const db = getFirestore();
const now = Date.now();
const communityRef = db.collection('communities').doc(communityId);
const discoveryRef = db.collection('community_discovery_index').doc(communityId);
const previousSeedManagersQuery = communityRef
  .collection('members')
  .where('seedScenario', '==', SEED_MANAGER_MARKER)
  .limit(20);
const activeOwnersQuery = communityRef
  .collection('members')
  .where('role', '==', 'owner')
  .where('status', '==', 'active')
  .limit(3);
const [
  communitySnapshot,
  discoverySnapshot,
  previousSeedManagersSnapshot,
  activeOwnersSnapshot,
] = await Promise.all([
  communityRef.get(),
  discoveryRef.get(),
  previousSeedManagersQuery.get(),
  activeOwnersQuery.get(),
]);

if (!communitySnapshot.exists) {
  console.error(
    `[seed:community-memberships] Abortado: communities/${communityId} ausente. Execute primeiro npm.cmd run seed:communities:emu.`
  );
  process.exit(1);
}

const communityData = communitySnapshot.data() ?? {};
if (communityData?.source?.type !== 'community') {
  console.error(
    `[seed:community-memberships] Abortado: communities/${communityId} não é uma Comunidade. source.type=${communityData?.source?.type ?? 'ausente'}.`
  );
  process.exit(1);
}

if (communityData?.access?.join !== 'approval') {
  console.error(
    `[seed:community-memberships] Abortado: communities/${communityId} precisa usar access.join=approval para manter as solicitações pendentes coerentes.`
  );
  process.exit(1);
}

if (managerRole === 'owner') {
  const conflictingOwners = activeOwnersSnapshot.docs.filter(
    (document) =>
      document.id !== managerUid
      && document.data()?.seedScenario !== SEED_MANAGER_MARKER
  );

  if (conflictingOwners.length > 0) {
    console.error(
      '[seed:community-memberships] Abortado: existe outro proprietário ativo que não foi criado por este cenário de seed.'
    );
    console.error(
      '[seed:community-memberships] Restaure o cenário-base antes de testar o papel owner para não sobrescrever propriedade manual.'
    );
    process.exit(1);
  }
}

const batch = db.batch();
const managerMembershipRef = communityRef.collection('members').doc(managerUid);
const communityUpdate = {
  'metrics.memberCount': COMMUNITY_PREVIEW_BASELINE_MEMBER_COUNT,
};

if (managerRole === 'owner') {
  communityUpdate.ownerUid = managerUid;
  communityUpdate.ownerSeedSource = SEED_MANAGER_MARKER;
  communityUpdate.ownerSeededAt = now;
} else if (communityData?.ownerSeedSource === SEED_MANAGER_MARKER) {
  communityUpdate.ownerUid = FieldValue.delete();
  communityUpdate.ownerSeedSource = FieldValue.delete();
  communityUpdate.ownerSeededAt = FieldValue.delete();
}

batch.update(communityRef, communityUpdate);

if (discoverySnapshot.exists) {
  batch.update(discoveryRef, {
    'metrics.memberCount': COMMUNITY_PREVIEW_BASELINE_MEMBER_COUNT,
  });
}

for (const document of previousSeedManagersSnapshot.docs) {
  if (document.id === managerUid) continue;

  batch.set(
    document.ref,
    {
      role: 'member',
      status: 'left',
      leftAt: now,
      blockedAt: FieldValue.delete(),
      blockedBy: FieldValue.delete(),
      blockedByRole: FieldValue.delete(),
      blockedPreviousRole: FieldValue.delete(),
      updatedAt: now,
      source: 'emulator-seed',
      seedScenario: SEED_MANAGER_MARKER,
    },
    { merge: true }
  );
}

batch.set(
  managerMembershipRef,
  {
    communityId,
    uid: managerUid,
    role: managerRole,
    status: 'active',
    requestedAt: null,
    joinedAt: now,
    leftAt: null,
    reviewedAt: null,
    reviewedBy: null,
    requestResolution: null,
    blockedAt: FieldValue.delete(),
    blockedBy: FieldValue.delete(),
    blockedByRole: FieldValue.delete(),
    blockedPreviousRole: FieldValue.delete(),
    updatedAt: now,
    policyVersion: 1,
    source: 'emulator-seed',
    seedScenario: SEED_MANAGER_MARKER,
  },
  { merge: true }
);

function seedUserProfile(user) {
  const userRef = db.collection('users').doc(user.uid);
  batch.set(
    userRef,
    {
      uid: user.uid,
      nickname: user.nickname,
      nome: user.nickname,
      photoURL: null,
      accountStatus: 'active',
      profileCompleted: true,
      idade: 30,
      initialAdultConsentRequired: true,
      adultConsent: {
        accepted: true,
        version: 'emulator-seed',
        acceptedAt: now,
        updatedAt: now,
        source: 'emulator-seed',
      },
      ageReverification: { status: 'NONE' },
      updatedAt: now,
      source: 'emulator-seed',
    },
    { merge: true }
  );
}

for (const user of pendingUsers) {
  seedUserProfile(user);
  const membershipRef = communityRef.collection('members').doc(user.uid);

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
      blockedAt: FieldValue.delete(),
      blockedBy: FieldValue.delete(),
      blockedByRole: FieldValue.delete(),
      blockedPreviousRole: FieldValue.delete(),
      updatedAt: now,
      policyVersion: 1,
      source: 'emulator-seed',
    },
    { merge: true }
  );
}

for (const user of managedUsers) {
  seedUserProfile(user);
  const membershipRef = communityRef.collection('members').doc(user.uid);
  const isBlocked = user.status === 'blocked';

  batch.set(
    membershipRef,
    {
      communityId,
      uid: user.uid,
      role: user.role,
      status: user.status,
      requestedAt: null,
      joinedAt: now - user.joinedOffsetMs,
      leftAt: null,
      reviewedAt: null,
      reviewedBy: null,
      requestResolution: null,
      blockedAt: isBlocked ? now - user.blockedOffsetMs : null,
      blockedBy: isBlocked ? user.blockedBy : null,
      blockedByRole: isBlocked ? user.blockedByRole : null,
      blockedPreviousRole: isBlocked ? user.roleBeforeBlock : null,
      updatedAt: isBlocked ? now - user.blockedOffsetMs : now - user.joinedOffsetMs,
      policyVersion: 1,
      source: 'emulator-seed',
    },
    { merge: true }
  );
}

await batch.commit();

console.log(
  `[seed:community-memberships] Projeto=${projectId} | Firestore=${emulatorHost} | Auth=${authEmulatorHost}`
);
console.log(
  `[seed:community-memberships] Gestor=${managerUser.email ?? managerUid} | Papel=${managerRole} | Comunidade=${communityId}`
);
console.log(
  `[seed:community-memberships] memberCount restaurado=${COMMUNITY_PREVIEW_BASELINE_MEMBER_COUNT}`
);
console.log(
  `[seed:community-memberships] Solicitações pendentes=${pendingUsers.length}`
);
console.log(
  `[seed:community-memberships] Participantes de gestão=${managedUsers.length}`
);
console.log('[seed:community-memberships] Concluído sem limpar dados fora do cenário reservado.');
