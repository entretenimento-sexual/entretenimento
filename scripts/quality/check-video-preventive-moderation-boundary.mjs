// scripts/quality/check-video-preventive-moderation-boundary.mjs
// -----------------------------------------------------------------------------
// MEDIA MODERATION TIMING BOUNDARY
// -----------------------------------------------------------------------------
// Garante paridade de timing e segurança entre Foto e Vídeo:
// - novos vídeos entram em PENDING_REVIEW e exigem revisão;
// - safetyScore pode permanecer desconhecido até existir sinal real;
// - reprodução pública exige APPROVED e mantém quarentena;
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
  "defaultVideoPublicationModerationStatus(): 'PENDING_REVIEW'",
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
  requireIncludes(publication, fragment, 'video publication boundary drift');
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
    'publisher transaction owns preventive review'
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
const deletionCommit = read(
  'functions/src/media/application/video-profile-deletion-commit.firestore.ts'
);
requireIncludes(
  deletion,
  'await commitProfileVideoDeletionRequest(db, {',
  'profile deletion must use the transactional commit'
);
for (const fragment of [
  "moderationStatus === 'FLAGGED'",
  "moderationStatus === 'PENDING_REVIEW'",
  "snapshot.get('isPublished') === true",
  "evidenceRetention === 'PUBLISHED_ASSET_LOCKED'",
  'checkPublicationHold(publication, command.allowQuarantined === true)',
]) {
  requireIncludes(
    deletionCommit,
    fragment,
    'restricted publications remain protected in transaction'
  );
}
const review = read(
  'functions/src/media/application/review-video-content-report.handler.ts'
);
for (const fragment of [
  "'preventive_media_review'",
  "moderationStatus: 'APPROVED'",
  'canReleaseVideoReportQuarantine({',
  "if (isPreventiveReview && decision === 'KEEP' && !releaseQuarantine)",
  "[quarantineLinkField]: FieldValue.delete()",
  "if (releaseQuarantine && publicationSnap.exists)",
  "reviewEvidenceRetention: 'RELEASED_AFTER_REVIEW'",
]) {
  requireIncludes(review, fragment, 'explicit review release drift');
}


for (const fragment of [
  "const quarantineLinkField = isPreventiveReview",
  "'preventiveReviewReportId'",
  "'activeVideoQuarantineReportId'",
]) {
  requireIncludes(review, fragment, 'review must clear only the causal hold');
}
const report = read(
  'functions/src/media/application/report-video-content.handler.ts'
);
for (const fragment of [
  'activeVideoQuarantineReportId: reportId',
  'quarantinedAssetVersion',
]) {
  requireIncludes(report, fragment, 'reported video quarantine must be fenced');
}
const causalReleasePolicy = read(
  'functions/src/media/application/video-report-quarantine-release.policy.ts'
);
for (const fragment of [
  'export function canReleaseVideoReportQuarantine',
  'video.activeVideoQuarantineReportId === reportId',
  'publication.activeVideoQuarantineReportId === reportId',
  'video.preventiveReviewReportId === reportId',
  'publication.preventiveReviewReportId === reportId',
  'publication.isPublished !== true',
]) {
  requireIncludes(causalReleasePolicy, fragment, 'causal release authority drift');
}

const photoGallery = read(
  'src/app/media/photos/profile-photos/profile-photos.component.html'
);

for (const forbidden of [
  'Aguardando análise',
  'revisão preventiva',
  'ainda não participa da distribuição pública',
]) {
  forbidIncludes(
    photoGallery,
    forbidden,
    'photo gallery must not present mandatory preventive moderation'
  );
}

const legacyPhotoMigration = read(
  'functions/src/media/application/legacy-photo-preventive-review-migration.service.ts'
);

for (const fragment of [
  "'preventive_media_review'",
  "moderationStatus: 'APPROVED'",
  'LEGACY_PREVENTIVE_REVIEW_RELEASED',
  'real_moderation_present',
]) {
  requireIncludes(
    legacyPhotoMigration,
    fragment,
    'legacy photo preventive-review cleanup boundary drift'
  );
}

const discovery = read(
  'functions/src/media/application/get-public-media-discovery.handler.ts'
);
requireIncludes(
  discovery,
  ".where('moderationStatus', '==', 'APPROVED')",
  'public discovery must remain approval-gated'
);

const commit = read('functions/src/media/application/video-publication-commit.firestore.ts');
for (const fragment of [
  'transaction.create(preventiveReviewRef, {',
  "reason: 'preventive_media_review'",
  'preventiveReviewReportId: preventiveReviewRef.id',
]) requireIncludes(commit, fragment, 'atomic preventive review');
const legacy = read('functions/src/media/application/normalize-legacy-video-moderation.handler.ts');
forbidIncludes(legacy, "moderationStatus: 'APPROVED'", 'legacy normalization must not approve');
requireIncludes(settings, "normalizedPublicationStatus !== 'APPROVED'", 'owner edit must preserve quarantine');

console.log(
  '[media-moderation-timing] OK: vídeos não avaliados exigem revisão preventiva.'
);
