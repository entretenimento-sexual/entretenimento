// scripts/quality/check-video-upload-reservation-boundary.mjs
// -----------------------------------------------------------------------------
// VIDEO UPLOAD RESERVATION BOUNDARY
// -----------------------------------------------------------------------------
// Impede regressão para upload direto de vídeo sem reserva, MIME genérico ou
// registro backend desacoplado da autoridade criada antes do Storage.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[video-upload-reservation-boundary] ' + label + ': ' + fragment);
  }
}

const storageRules = read('storage.rules');
if (storageRules.includes("contentType.matches('video/.*')")) {
  throw new Error(
    '[video-upload-reservation-boundary] Storage voltou a aceitar MIME genérico de vídeo.'
  );
}
if (storageRules.includes('500 * 1024 * 1024') || storageRules.includes('150 * 1024 * 1024')) {
  throw new Error(
    '[video-upload-reservation-boundary] Storage não deve duplicar o limite canônico de bytes.'
  );
}

for (const fragment of [
  'mediaVideoReservationId',
  'media_video_upload_reservations',
  'hasActiveVideoUploadReservation',
  'hasActiveVideoPosterReservation',
  "request.resource.contentType == 'video/mp4'",
  "request.resource.contentType == 'video/mxf'",
  'videoUploadReservation().videoSizeBytes == request.resource.size',
]) {
  requireIncludes(storageRules, fragment, 'storage reservation drift');
}

const flow = read('src/app/core/services/media/video-upload-flow.service.ts');
for (const fragment of [
  "'reserveVideoUpload'",
  'await this.reserveVideoUpload({',
  'mediaVideoReservationId: reservationId',
  'reservationId: reservation.reservationId',
]) {
  requireIncludes(flow, fragment, 'frontend reservation drift');
}

const registration = read(
  'functions/src/media/application/register-private-video-upload.handler.ts'
);
for (const fragment of [
  'assertVideoUploadReservation',
  'consumeVideoUploadReservationBestEffort',
  "metadata.metadata?.['mediaVideoReservationId']",
]) {
  requireIncludes(registration, fragment, 'registration reservation drift');
}

// Registro e cleanup competem pela mesma reserva em transação.
for (const fragment of [
  'claimVideoUploadReservation({ reservationId, ownerUid, videoId })',
  'releaseVideoUploadReservationClaim(reservationId, claimToken)',
  'let claimToken: string | null = null;',
]) {
  requireIncludes(registration, fragment, 'registration claim boundary drift');
}
if (registration.includes('deleteUploadedAssetsRecoverably(')) {
  throw new Error('[video-upload-reservation-boundary] Rollback destrutivo legado voltou ao registro.');
}
const invalidPosterPathBranch = registration.split(
  'if (rawPosterStoragePath && !posterStoragePath) {'
)[1]?.split('throw new HttpsError(')[0] ?? '';
if (!invalidPosterPathBranch || invalidPosterPathBranch.includes('deleteUploadedAssetsRecoverably')) {
  throw new Error(
    '[video-upload-reservation-boundary] Path de capa inválido não pode apagar objeto antes de validar reserva.'
  );
}

const reservation = read(
  'functions/src/media/application/reserve-video-upload.handler.ts'
);
for (const fragment of [
  'REQUIRE_CALLABLE_APP_CHECK',
  'consumeBackendRateLimitQuota',
  'evaluateVideoUploadQuota',
  'cleanupExpiredVideoUploadReservations',
  'claimVideoUploadReservation',
  "phase: 'CLEANING'",
  "phase: 'REGISTERING'",
  'PHASE_LEASE_MS',
]) {
  requireIncludes(reservation, fragment, 'backend reservation drift');
}

console.log(
  '[video-upload-reservation-boundary] OK: vídeo exige reserva, MIME exato, quota, App Check/rate limit e cleanup.'
);
