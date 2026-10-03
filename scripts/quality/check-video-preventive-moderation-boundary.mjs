// scripts/quality/check-video-preventive-moderation-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA MODERATION TIMING BOUNDARY
// -----------------------------------------------------------------------------
// Garante paridade de timing e segurança entre Foto e Vídeo:
// - publicação entra ativa por padrão, sem fila humana preventiva;
// - safetyScore pode permanecer desconhecido até existir sinal real;
// - denúncia ou mecanismo em tempo real pode mover conteúdo para quarentena;
// - edição do proprietário nunca libera estado restrito imposto por moderação;
// - upload ainda não publicado permanece PRIVATE;
// - discovery público continua aceitando apenas APPROVED.
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
    throw new Error('[media-moderation-timing] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[media-moderation-timing] ' + label + ': ' + fragment);
  }
}

const policy = read(
  'functions/src/media/application/video-publication-moderation.policy.ts'
);

for (const fragment of [
  "defaultVideoPublicationModerationStatus(): 'APPROVED'",
  "return 'APPROVED';",
  'safetyScore: null,',
  'isRestrictedVideoModerationStatus',
]) {
  requireIncludes(policy, fragment, 'moderation timing policy drift');
}

for (const forbidden of [
  'VIDEO_PREVENTIVE_REVIEW_REASON',
  'VIDEO_PREVENTIVE_REVIEW_MESSAGE',
  'buildPreventiveVideoReviewId',
]) {
  forbidIncludes(
    policy,
    forbidden,
    'preventive review queue must not return'
  );
}

const registration = read(
  'functions/src/media/application/register-private-video-upload.handler.ts'
);
requireIncludes(
  registration,
  "moderationStatus: 'PRIVATE'",
  'unpublished video draft must remain private'
);
forbidIncludes(
  registration,
  "moderationStatus: 'PENDING_REVIEW'",
  'registration must not seed preventive review'
);

const publication = read(
  'functions/src/media/application/manage-video-publication.handler.ts'
);

for (const fragment of [
  'buildUnassessedVideoScoreBreakdown()',
  'defaultVideoPublicationModerationStatus()',
  'moderationReason: null',
  'safetyScore: null,',
]) {
  requireIncludes(publication, fragment, 'immediate publication wiring drift');
}

for (const forbidden of [
  'buildPreventiveVideoReviewId(',
  'VIDEO_PREVENTIVE_REVIEW_MESSAGE',
  'VIDEO_PREVENTIVE_REVIEW_REASON',
  'batch.create(moderationReportRef',
]) {
  forbidIncludes(
    publication,
    forbidden,
    'publication must not create preventive moderation work'
  );
}

const settings = read(
  'functions/src/media/application/update-video-publication-settings.handler.ts'
);

for (const fragment of [
  "currentPublication?.moderationStatus ?? 'PRIVATE'",
  "const moderationStatus = isPublished",
  "resolveVideoModerationAfterOwnerEdit(currentModerationStatus)",
  ": 'PRIVATE';",
]) {
  requireIncludes(settings, fragment, 'owner edit moderation drift');
}

const deletion = read(
  'functions/src/media/application/delete-profile-video.handler.ts'
);
for (const fragment of [
  "moderationStatus !== 'PENDING_REVIEW'",
  "publication?.isPublished === true",
  "evidenceRetention === 'PUBLISHED_ASSET_LOCKED'",
]) {
  requireIncludes(
    deletion,
    fragment,
    'published pending review asset must remain protected while failed unpublished uploads stay cleanable'
  );
}

const review = read(
  'functions/src/media/application/review-video-content-report.handler.ts'
);
for (const fragment of [
  "'preventive_media_review'",
  "moderationStatus: 'APPROVED'",
  'preventiveReviewReportId: FieldValue.delete()',
  "reviewEvidenceRetention: 'RELEASED_AFTER_REVIEW'",
]) {
  requireIncludes(review, fragment, 'explicit review release drift');
}

const discovery = read(
  'functions/src/media/application/get-public-media-discovery.handler.ts'
);
requireIncludes(
  discovery,
  ".where('moderationStatus', '==', 'APPROVED')",
  'public discovery must remain approval-gated'
);

console.log(
  '[media-moderation-timing] OK: publicação é imediata; moderação atua depois ou em tempo real, e estados restritos continuam fail-closed.'
);
