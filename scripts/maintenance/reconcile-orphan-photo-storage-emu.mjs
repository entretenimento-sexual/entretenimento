// scripts/maintenance/reconcile-orphan-photo-storage-emu.mjs
// -----------------------------------------------------------------------------
// RECONCILIAÇÃO DE FOTOS PRIVADAS ÓRFÃS — SOMENTE FIREBASE EMULATOR
// -----------------------------------------------------------------------------
// Objetivo:
// - detectar documentos users/{uid}/photos/{photoId} cujo objeto privado não
//   existe mais no Storage Emulator;
// - nunca considerar falhas transitórias como ausência: a inspeção canônica
//   propaga erros e só classifica ausência quando Storage confirma "not found";
// - dry-run por padrão;
// - execução real exige --apply E PHOTO_STORAGE_RECONCILE_CONFIRM=true;
// - mutação reutiliza a autoridade backend deleteProfilePhotoResources();
// - caminhos privados inválidos são apenas reportados, nunca apagados;
// - o script falha fechado se Auth/Firestore/Storage Emulator não estiverem
//   acessíveis pelo Emulator Hub local.
//
// Uso:
//   npm run functions:build
//   node scripts/maintenance/reconcile-orphan-photo-storage-emu.mjs --dry-run
//   node scripts/maintenance/reconcile-orphan-photo-storage-emu.mjs --dry-run --owner=<uid>
//
// Execução real:
//   $env:PHOTO_STORAGE_RECONCILE_CONFIRM='true'
//   node scripts/maintenance/reconcile-orphan-photo-storage-emu.mjs --apply
// -----------------------------------------------------------------------------

const PROJECT_ID = 'entretenimento-sexual';
const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;
const HUB_URL = 'http://127.0.0.1:4400/emulators';
const FIRESTORE_HOST = '127.0.0.1:8080';
const STORAGE_HOST = '127.0.0.1:9199';
const FUNCTIONS_HOST = '127.0.0.1:5001';

function readArgValue(prefix) {
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : '';
}

function hasArg(name) {
  return process.argv.includes(name);
}

function cleanOwnerUid(value) {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : null;
}

function safePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

async function assertLocalEmulators() {
  let response;

  try {
    response = await fetch(HUB_URL, {
      signal: AbortSignal.timeout(2500),
    });
  } catch (error) {
    throw new Error(
      `Emulator Hub não está acessível em ${HUB_URL}. Inicie o ambiente emulado antes da reconciliação. ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Emulator Hub respondeu HTTP ${response.status}. Reconciliação abortada.`
    );
  }

  const emulators = await response.json();
  for (const required of ['firestore', 'storage', 'functions']) {
    if (!emulators?.[required]) {
      throw new Error(
        `Emulador obrigatório ausente no Hub: ${required}. Reconciliação abortada.`
      );
    }
  }
}

function configureEmulatorEnvironment() {
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.GCP_PROJECT = PROJECT_ID;
  process.env.FIREBASE_STORAGE_BUCKET = STORAGE_BUCKET;

  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;

  // firebase-admin/@google-cloud/storage reconhece STORAGE_EMULATOR_HOST.
  process.env.STORAGE_EMULATOR_HOST = `http://${STORAGE_HOST}`;
  // Mantido também para SDKs Firebase que consultem a variável específica.
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = STORAGE_HOST;

  process.env.FUNCTIONS_EMULATOR = 'true';
  process.env.FUNCTIONS_EMULATOR_HOST = FUNCTIONS_HOST;
}

async function loadCanonicalRuntime() {
  let consistencyModule;
  let firebaseModule;

  try {
    [consistencyModule, firebaseModule] = await Promise.all([
      import(
        '../../functions/lib/media/application/private-photo-storage-consistency.service.js'
      ),
      import('../../functions/lib/firebaseApp.js'),
    ]);
  } catch (error) {
    throw new Error(
      [
        'Não foi possível carregar a camada backend compilada.',
        'Execute "npm run functions:build" antes da reconciliação.',
        error instanceof Error ? error.message : String(error),
      ].join(' ')
    );
  }

  const inspect =
    consistencyModule.inspectPrivatePhotoStorageConsistency ??
    consistencyModule.default?.inspectPrivatePhotoStorageConsistency;
  const reconcile =
    consistencyModule.reconcilePrivatePhotoStorageConsistency ??
    consistencyModule.default?.reconcilePrivatePhotoStorageConsistency;
  const db = firebaseModule.db ?? firebaseModule.default?.db;

  if (typeof inspect !== 'function' || typeof reconcile !== 'function' || !db) {
    throw new Error(
      'Exports canônicos de consistência de foto privada não foram encontrados.'
    );
  }

  return { inspect, reconcile, db };
}

async function listPhotoRefs(db, ownerUid, maxPhotos) {
  if (ownerUid) {
    const snapshot = await db
      .collection(`users/${ownerUid}/photos`)
      .limit(maxPhotos)
      .get();

    return snapshot.docs.map((doc) => ({
      ownerUid,
      photoId: doc.id,
    }));
  }

  const usersSnapshot = await db
    .collection('users')
    .limit(maxPhotos)
    .get();

  const refs = [];

  for (const userDoc of usersSnapshot.docs) {
    if (refs.length >= maxPhotos) break;

    const remaining = maxPhotos - refs.length;
    const photosSnapshot = await db
      .collection(`users/${userDoc.id}/photos`)
      .limit(remaining)
      .get();

    for (const photoDoc of photosSnapshot.docs) {
      refs.push({
        ownerUid: userDoc.id,
        photoId: photoDoc.id,
      });

      if (refs.length >= maxPhotos) break;
    }
  }

  return refs;
}

async function main() {
  const apply = hasArg('--apply');
  const explicitDryRun = hasArg('--dry-run');
  const dryRun = !apply;
  const ownerUidRaw = readArgValue('--owner=');
  const ownerUid = ownerUidRaw ? cleanOwnerUid(ownerUidRaw) : null;
  const maxPhotos = safePositiveInt(
    readArgValue('--max=') || process.env.PHOTO_STORAGE_RECONCILE_MAX,
    5000,
    50_000
  );
  const confirmed =
    String(process.env.PHOTO_STORAGE_RECONCILE_CONFIRM || '')
      .trim()
      .toLowerCase() === 'true';

  if (apply && explicitDryRun) {
    throw new Error('Use --dry-run ou --apply, nunca os dois ao mesmo tempo.');
  }

  if (ownerUidRaw && !ownerUid) {
    throw new Error('UID informado em --owner é inválido.');
  }

  if (apply && !confirmed) {
    throw new Error(
      'Execução real bloqueada. Use --apply e defina PHOTO_STORAGE_RECONCILE_CONFIRM=true.'
    );
  }

  await assertLocalEmulators();
  configureEmulatorEnvironment();

  const { inspect, reconcile, db } = await loadCanonicalRuntime();
  const refs = await listPhotoRefs(db, ownerUid, maxPhotos);

  const summary = {
    projectId: PROJECT_ID,
    emulatorOnly: true,
    dryRun,
    ownerUid: ownerUid ?? null,
    maxPhotos,
    scanned: 0,
    consistent: 0,
    missingStorageObject: 0,
    invalidPrivatePath: 0,
    missingPrivateDocument: 0,
    reconciled: 0,
    cleanupPending: 0,
    failures: 0,
  };

  for (const ref of refs) {
    summary.scanned += 1;

    try {
      const inspection = await inspect(ref.ownerUid, ref.photoId);

      if (inspection.state === 'consistent') {
        summary.consistent += 1;
        continue;
      }

      if (inspection.state === 'missing_private_document') {
        summary.missingPrivateDocument += 1;
        console.warn('[photo-storage-reconcile] documento desapareceu durante scan', {
          ownerUid: ref.ownerUid,
          photoId: ref.photoId,
        });
        continue;
      }

      if (inspection.state === 'invalid_private_path') {
        summary.invalidPrivatePath += 1;
        console.error('[photo-storage-reconcile] path privado inválido; revisão manual necessária', {
          ownerUid: ref.ownerUid,
          photoId: ref.photoId,
        });
        continue;
      }

      summary.missingStorageObject += 1;
      console.warn('[photo-storage-reconcile] objeto ausente', {
        ownerUid: ref.ownerUid,
        photoId: ref.photoId,
        storagePath: inspection.storagePath,
        dryRun,
      });

      if (dryRun) continue;

      const result = await reconcile(ref.ownerUid, ref.photoId);

      if (result.reconciled) {
        summary.reconciled += 1;
        if (result.cleanupPending) summary.cleanupPending += 1;
      } else {
        console.warn('[photo-storage-reconcile] estado mudou antes da reconciliação', {
          ownerUid: ref.ownerUid,
          photoId: ref.photoId,
          state: result.state,
        });
      }
    } catch (error) {
      summary.failures += 1;
      console.error('[photo-storage-reconcile] falha', {
        ownerUid: ref.ownerUid,
        photoId: ref.photoId,
        code: error?.code ?? null,
        message: error?.message ?? String(error),
      });
    }
  }

  console.log('[photo-storage-reconcile] resumo', summary);

  if (summary.invalidPrivatePath > 0 || summary.failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[photo-storage-reconcile] abortado', {
    code: error?.code ?? null,
    message: error?.message ?? String(error),
  });
  process.exitCode = 1;
});
