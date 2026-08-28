// scripts/dev/inspect-auth-profile-integrity-emulator.mjs
// -----------------------------------------------------------------------------
// DIAGNÓSTICO DEV/EMULATOR - INTEGRIDADE AUTH ↔ USERS ↔ PUBLIC_PROFILES
// -----------------------------------------------------------------------------
// Objetivo:
// - identificar divergências de UID/nickname entre Firebase Auth, users/{uid}
//   e public_profiles/{uid};
// - mostrar apenas metadados necessários ao diagnóstico, sem email completo e
//   sem coordenadas;
// - expor se o Firebase Auth permite os efeitos pós-login que dependem de
//   emailVerified=true;
// - nunca escrever dados e nunca executar fora dos emuladores locais.
//
// Uso (PowerShell):
//   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
//   $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
//   $env:FIREBASE_PROJECT_ID="entretenimento-sexual"
//   node .\scripts\dev\inspect-auth-profile-integrity-emulator.mjs
// -----------------------------------------------------------------------------

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '').trim();

if (!isLocalEmulatorHost(firestoreHost) || !isLocalEmulatorHost(authHost)) {
  console.error(
    '[inspect:auth-profile] Abortado: FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST devem apontar para localhost/127.0.0.1.'
  );
  process.exit(1);
}

initializeApp({ projectId });

const db = getFirestore();
const auth = getAuth();

const [usersSnapshot, publicProfilesSnapshot, authUsers] = await Promise.all([
  db.collection('users').get(),
  db.collection('public_profiles').get(),
  listAllAuthUsers(auth),
]);

const usersByUid = new Map(
  usersSnapshot.docs.map((doc) => [doc.id, doc.data() ?? {}])
);
const publicProfilesByUid = new Map(
  publicProfilesSnapshot.docs.map((doc) => [doc.id, doc.data() ?? {}])
);
const authByUid = new Map(authUsers.map((user) => [user.uid, user]));

const allUids = Array.from(
  new Set([
    ...authByUid.keys(),
    ...usersByUid.keys(),
    ...publicProfilesByUid.keys(),
  ])
).sort();

const rows = allUids.map((uid) => {
  const authUser = authByUid.get(uid) ?? null;
  const user = usersByUid.get(uid) ?? null;
  const publicProfile = publicProfilesByUid.get(uid) ?? null;

  const userNickname = cleanText(user?.nickname);
  const publicNickname = cleanText(publicProfile?.nickname);
  const authDisplayName = cleanText(authUser?.displayName);
  const authEmailVerified = authUser?.emailVerified === true;
  const userEmailVerified = user?.emailVerified === true;

  return {
    uid,
    authExists: !!authUser,
    userExists: !!user,
    publicProfileExists: !!publicProfile,
    authDisplayName,
    userNickname,
    publicNickname,
    nicknameConsistent:
      !userNickname || !publicNickname || normalizeNickname(userNickname) === normalizeNickname(publicNickname),
    authEmailVerified,
    userEmailVerified,
    postLoginAuthEligible: !!authUser && authEmailVerified,
    hasPrivateLocation: hasValidLocation(user),
    hasPublicLocation: hasValidLocation(publicProfile),
    hasLastLocationAt: user?.lastLocationAt != null,
  };
});

const identityMismatches = rows.filter(
  (row) =>
    (row.userExists && !row.authExists) ||
    (row.publicProfileExists && !row.userExists) ||
    !row.nicknameConsistent
);

const duplicateNicknames = findDuplicateNicknames(rows);
const withoutPrivateLocation = rows.filter(
  (row) => row.userExists && row.publicProfileExists && !row.hasPrivateLocation
);
const postLoginAuthIneligible = rows.filter(
  (row) => row.authExists && row.postLoginAuthEligible !== true
);

console.log('[inspect:auth-profile] Resumo.', {
  projectId,
  firestoreHost,
  authHost,
  authUsers: authByUid.size,
  userDocuments: usersByUid.size,
  publicProfiles: publicProfilesByUid.size,
  identityMismatchCount: identityMismatches.length,
  duplicateNicknameCount: duplicateNicknames.length,
  withoutPrivateLocationCount: withoutPrivateLocation.length,
  postLoginAuthIneligibleCount: postLoginAuthIneligible.length,
});

console.log('[inspect:auth-profile] Perfis sem localização privada.', withoutPrivateLocation);
console.log('[inspect:auth-profile] Contas sem elegibilidade Auth para pós-login.', postLoginAuthIneligible);
console.log('[inspect:auth-profile] Divergências por UID.', identityMismatches);
console.log('[inspect:auth-profile] Nicknames associados a múltiplos UIDs.', duplicateNicknames);

function isLocalEmulatorHost(value) {
  return /^(127\.0\.0\.1|localhost):\d+$/.test(value);
}

async function listAllAuthUsers(authInstance) {
  const users = [];
  let pageToken;

  do {
    const result = await authInstance.listUsers(1000, pageToken);
    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);

  return users;
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeNickname(value) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function hasValidLocation(source) {
  if (!source || typeof source !== 'object') return false;

  const latitude = source.latitude;
  const longitude = source.longitude;

  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

function findDuplicateNicknames(rowsToInspect) {
  const byNickname = new Map();

  for (const row of rowsToInspect) {
    for (const [layer, nickname] of [
      ['users', row.userNickname],
      ['public_profiles', row.publicNickname],
    ]) {
      if (!nickname) continue;

      const key = normalizeNickname(nickname);
      const bucket = byNickname.get(key) ?? [];
      bucket.push({ layer, uid: row.uid, nickname });
      byNickname.set(key, bucket);
    }
  }

  const duplicates = [];

  for (const [normalizedNickname, entries] of byNickname.entries()) {
    const uniqueUids = Array.from(new Set(entries.map((entry) => entry.uid)));
    if (uniqueUids.length <= 1) continue;

    duplicates.push({ normalizedNickname, uniqueUids, entries });
  }

  return duplicates;
}
