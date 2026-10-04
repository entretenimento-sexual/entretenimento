// scripts/quality/check-private-photo-authority-boundary.mjs
// -----------------------------------------------------------------------------
// PRIVATE PHOTO AUTHORITY BOUNDARY
// -----------------------------------------------------------------------------
// Fase 1 da convergência Foto -> fronteira backend:
// - create/delete de users/{uid}/photos são backend-only;
// - url/path/fileName/createdAt não podem ser alterados pelo cliente;
// - displayDate + updatedAt continuam client-side como organização privada;
// - commit crítico valida reserva + objeto Storage no backend.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[private-photo-authority] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[private-photo-authority] ' + label + ': ' + fragment);
  }
}

const rules = read('firestore-rules/users_photos.rules');
for (const fragment of [
  'allow create: if false;',
  'allow delete: if false;',
  'request.resource.data.diff(resource.data).affectedKeys().hasOnly([',
  '"displayDate"',
  '"updatedAt"',
]) {
  requireIncludes(rules, fragment, 'private photo rules drift');
}

const firestoreService = read(
  'src/app/core/services/image-handling/photo-firestore.service.ts'
);
for (const fragment of [
  "'registerPrivatePhotoUpload'",
  "mode: 'create' | 'replace'",
  'commitCriticalPhotoMetadata',
]) {
  requireIncludes(
    firestoreService,
    fragment,
    'photo client must route critical metadata through backend'
  );
}
forbidIncludes(
  firestoreService,
  'await setDoc(photoRef, photo)',
  'photo client must not recreate direct private-photo create'
);

const handler = read(
  'functions/src/media/application/register-private-photo-upload.handler.ts'
);
for (const fragment of [
  'mediaPhotoReservationId',
  'getDefaultStorageBucket().file(storagePath)',
  'reservationExpiresAt <= Date.now()',
  'storedReservationId !== reservationId',
  'transaction.create(photoRef',
  'transaction.update(photoRef',
  'transaction.delete(reservationRef)',
  'assertMediaAuthoringEligibility(ownerUid)',
  'consumeBackendRateLimitQuota',
  'assertCallableAppCheck',
]) {
  requireIncludes(handler, fragment, 'private photo backend boundary drift');
}

for (const forbidden of [
  'assertInteractionAccess(ownerUid)',
  'isVerifiedAdultAgeDecision',
  'assertPublicMediaConsumptionAccess',
]) {
  forbidIncludes(
    handler,
    forbidden,
    'private photo backend must use canonical media authoring authority'
  );
}

const authoringEligibility = read(
  'functions/src/media/application/media-authoring-eligibility.service.ts'
);
for (const fragment of [
  'assertPlatformAccountAccessData',
  'evaluateCanonicalAgeEligibility',
  'ageEligibility.allowed',
  "ageEligibility.status === 'VERIFIED_ADULT'",
]) {
  requireIncludes(
    authoringEligibility,
    fragment,
    'media authoring eligibility boundary drift'
  );
}

const consistencyService = read(
  'functions/src/media/application/private-photo-storage-consistency.service.ts'
);
for (const fragment of [
  'inspectPrivatePhotoStorageConsistency',
  'reconcilePrivatePhotoStorageConsistency',
  'deleteProfilePhotoResources',
  "state: exists ? 'consistent' : 'missing_storage_object'",
]) {
  requireIncludes(
    consistencyService,
    fragment,
    'private photo storage consistency boundary drift'
  );
}

const emulatorReconcile = read(
  'scripts/maintenance/reconcile-orphan-photo-storage-emu.mjs'
);
for (const fragment of [
  'Emulator Hub',
  "const dryRun = !apply;",
  "PHOTO_STORAGE_RECONCILE_CONFIRM",
  "reconcilePrivatePhotoStorageConsistency",
  "invalid_private_path",
]) {
  requireIncludes(
    emulatorReconcile,
    fragment,
    'emulator orphan reconciliation must remain fail-closed and canonical'
  );
}

console.log(
  '[private-photo-authority] OK: critical private Photo mutations are backend-authoritative; only displayDate/updatedAt remain owner-writable.'
);
