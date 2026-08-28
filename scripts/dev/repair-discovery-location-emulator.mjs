// scripts/dev/repair-discovery-location-emulator.mjs
// -----------------------------------------------------------------------------
// REPARO DEV/EMULATOR - LOCALIZAÇÃO PÚBLICA DO DISCOVERY
// -----------------------------------------------------------------------------
// Objetivo:
// - reconciliar public_profiles/{uid}.latitude/longitude/geohash de dados já
//   importados no Emulator Suite;
// - reutilizar a mesma policy compilada do backend, sem duplicar precisão ou
//   geohash neste script;
// - diagnosticar perfis sem localização privada sem expor coordenadas;
// - nunca criar public_profile ausente e nunca escrever fora do emulador.
//
// Pré-requisitos:
// - Firestore Emulator em execução;
// - npm run functions:prepare executado para gerar functions/lib.
//
// Uso (PowerShell):
//   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
//   $env:FIREBASE_PROJECT_ID="entretenimento-sexual"
//   node .\scripts\dev\repair-discovery-location-emulator.mjs
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
const emulatorHost = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
const root = process.cwd();
const projectionModulePath = path.resolve(
  root,
  'functions',
  'lib',
  'discovery',
  'public-profile-discovery-projection.js'
);
const accessModulePath = path.resolve(
  root,
  'functions',
  'lib',
  'discovery',
  'public-profile-projection-access.js'
);

if (!isLocalEmulatorHost(emulatorHost)) {
  console.error(
    '[repair:discovery-location] Abortado: FIRESTORE_EMULATOR_HOST deve apontar para localhost/127.0.0.1.'
  );
  process.exit(1);
}

for (const requiredPath of [projectionModulePath, accessModulePath]) {
  if (!fs.existsSync(requiredPath)) {
    console.error(
      `[repair:discovery-location] Artefato ausente: ${path.relative(root, requiredPath)}. ` +
        'Execute npm run functions:prepare antes do reparo.'
    );
    process.exit(1);
  }
}

const require = createRequire(import.meta.url);
const {
  buildPublicLocationProjection,
  publicLocationProjectionMatches,
} = require(projectionModulePath);
const { isPublicProfileProjectionBlocked } = require(accessModulePath);

if (
  typeof buildPublicLocationProjection !== 'function' ||
  typeof publicLocationProjectionMatches !== 'function' ||
  typeof isPublicProfileProjectionBlocked !== 'function'
) {
  console.error(
    '[repair:discovery-location] Artefato de Functions incompatível. Recompile functions/lib.'
  );
  process.exit(1);
}

initializeApp({ projectId });
const db = getFirestore();
const usersSnapshot = await db.collection('users').get();

let processed = 0;
let updated = 0;
let unchanged = 0;
let skippedWithoutPublicProfile = 0;
let skippedBlocked = 0;
let skippedWithoutPrivateLocation = 0;
const missingPrivateLocationProfiles = [];

for (const userDoc of usersSnapshot.docs) {
  const uid = String(userDoc.id ?? '').trim();
  if (!uid) continue;

  processed += 1;
  const user = userDoc.data() ?? {};

  if (isPublicProfileProjectionBlocked(user)) {
    skippedBlocked += 1;
    continue;
  }

  const publicProfileRef = db.collection('public_profiles').doc(uid);
  const publicProfileSnapshot = await publicProfileRef.get();

  if (!publicProfileSnapshot.exists) {
    skippedWithoutPublicProfile += 1;
    continue;
  }

  const current = publicProfileSnapshot.data() ?? {};
  const expected = buildPublicLocationProjection(user);

  if (
    expected.latitude === null ||
    expected.longitude === null ||
    expected.geohash === null
  ) {
    skippedWithoutPrivateLocation += 1;
    missingPrivateLocationProfiles.push({
      uid,
      nickname: resolveNickname(user, current),
      hasLastLocationAt: user['lastLocationAt'] != null,
    });
    continue;
  }

  if (publicLocationProjectionMatches(current, expected)) {
    unchanged += 1;
    continue;
  }

  await publicProfileRef.set(
    {
      ...expected,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  updated += 1;
}

console.log('[repair:discovery-location] Concluído.', {
  projectId,
  emulatorHost,
  processed,
  updated,
  unchanged,
  skippedWithoutPublicProfile,
  skippedBlocked,
  skippedWithoutPrivateLocation,
  missingPrivateLocationProfiles,
});

function resolveNickname(user, publicProfile) {
  const nickname = String(
    user?.nickname ?? publicProfile?.nickname ?? 'sem-nickname'
  ).trim();
  return nickname || 'sem-nickname';
}

function isLocalEmulatorHost(value) {
  return /^(127\.0\.0\.1|localhost):\d+$/.test(value);
}
