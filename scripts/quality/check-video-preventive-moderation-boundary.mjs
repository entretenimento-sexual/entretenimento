// scripts/quality/check-video-preventive-moderation-boundary.mjs
// -----------------------------------------------------------------------------
// VIDEO PREVENTIVE MODERATION BOUNDARY
// -----------------------------------------------------------------------------
// Garante paridade de segurança com Fotos:
// - nova publicação nasce PENDING_REVIEW, nunca APPROVED;
// - safetyScore permanece desconhecido até decisão explícita;
// - publicação cria revisão preventiva de sistema e mantém o ativo retido;
// - edição do proprietário não promove conteúdo pendente;
// - exclusão do proprietário fica bloqueada durante a revisão;
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
    throw new Error('[video-preventive-moderation] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[video-preventive-moderation] ' + label + ': ' + fragment);
  }
}

const policy = read(
  'functions/src/media/application/video-publication-moderation.policy.ts'
);

for (const fragment of [
  "VIDEO_PREVENTIVE_REVIEW_REASON",
  "'preventive_media_review'",
  "defaultVideoPublicationModerationStatus(): 'PENDING_REVIEW'",
  "return 'PENDING_REVIEW';",
  'safetyScore: null,',
  'buildPreventiveVideoReviewId',
  "normalized === 'APPROVED' ? 'APPROVED' : 'PENDING_REVIEW'",
]) {
  requireIncludes(policy, fragment, 'preventive policy drift');
}

forbidIncludes(
  policy,
  "defaultVideoPublicationModerationStatus(): 'APPROVED'",
  'new videos must never be implicitly approved'
);

const publication = read(
  'functions/src/media/application/manage-video-publication.handler.ts'
);

for (const fragment of [
  'buildUnassessedVideoScoreBreakdown()',
  'buildPreventiveVideoReviewId(',
  'VIDEO_PREVENTIVE_REVIEW_MESSAGE',
  "reviewEvidenceRetention: 'PUBLISHED_ASSET_LOCKED'",
  'safetyScore: null,',
  'batch.create(moderationReportRef',
  "reporterUid: 'system'",
  "targetType: 'video'",
  'reason: VIDEO_PREVENTIVE_REVIEW_REASON',
  'contentQuarantined: true',
]) {
  requireIncludes(publication, fragment, 'publication quarantine wiring drift');
}

const settings = read(
  'functions/src/media/application/update-video-publication-settings.handler.ts'
);

for (const fragment of [
  "normalizedPublicationStatus === 'PENDING_REVIEW'",
  "? 'APPROVED'",
  ": 'PENDING_REVIEW'",
  "currentPublication?.moderationStatus ?? 'PENDING_REVIEW'",
]) {
  requireIncludes(settings, fragment, 'owner edit moderation drift');
}

const deletion = read(
  'functions/src/media/application/delete-profile-video.handler.ts'
);
requireIncludes(
  deletion,
  "moderationStatus === 'PENDING_REVIEW'",
  'pending review asset must remain protected from owner deletion'
);

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
  '[video-preventive-moderation] OK: videos remain quarantined until explicit moderation approval.'
);
