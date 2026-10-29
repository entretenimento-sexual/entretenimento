/**
 * Classificação estritamente informativa do original técnico legado.
 * Nenhum estado autoriza remoção. A avaliação não substitui a revisão
 * transacional por geração, as obrigações legais ou a migração de consumidores.
 *
 * Entrada: somente metadados. Nunca processar conteúdo de imagens.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const LEGACY_ORIGIN_BLOCKERS = Object.freeze([
  'invalid_identity_or_source',
  'no_active_publication',
  'published_metadata_invalid',
  'final_asset_missing_or_unpinned',
  'private_original_already_missing',
  'private_original_unpinned',
  'published_projection_missing_or_mismatched',
  'moderation_or_legal_review',
  'live_source_reference',
  'deletion_job_present',
  'pending_upload_lifecycle',
  'unmigrated_display_date',
  'legacy_consumers_or_retention_unverified',
]);

function ownedPath(ownerUid, photoId, value, kind) {
  if (!SAFE_ID.test(ownerUid) || !SAFE_ID.test(photoId) ||
      typeof value !== 'string') return false;
  const prefix = kind === 'original'
    ? `users/${ownerUid}/uploads/images/`
    : `users/${ownerUid}/published/images/${photoId}/`;
  const suffix = value.startsWith(prefix) ? value.slice(prefix.length) : '';
  return !!suffix && !suffix.includes('/') &&
    !Array.from(suffix).some((char) => {
      const cp = char.codePointAt(0);
      return cp <= 31 || cp === 127;
    });
}

function validGeneration(value) {
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}

export function classifyLegacyPhotoCleanupReadiness({
  ownerUid, photoId, originalPath, original,
  publication, projection, final, deletionJob, privateDocument,
}) {
  if (!ownedPath(ownerUid, photoId, originalPath, 'original')) {
    return 'invalid_identity_or_source';
  }
  if (!publication || publication.isPublished !== true) {
    return 'no_active_publication';
  }
  if (publication.ownerUid !== ownerUid ||
      publication.photoId !== photoId ||
      !['PUBLIC', 'FRIENDS'].includes(publication.visibility) ||
      !ownedPath(ownerUid, photoId, publication.publishedStoragePath, 'final') ||
      publication.publishedStoragePath === originalPath) {
    return 'published_metadata_invalid';
  }
  if (!final?.exists || !validGeneration(final.generation)) {
    return 'final_asset_missing_or_unpinned';
  }
  if (!original?.exists) return 'private_original_already_missing';
  if (!validGeneration(original.generation)) return 'private_original_unpinned';
  if (!projection || projection.ownerUid !== ownerUid ||
      projection.visibility !== publication.visibility ||
      projection.moderationStatus !== publication.moderationStatus ||
      Number(projection.assetVersion ?? projection.publishedAt) !==
        Number(publication.assetVersion ?? publication.publishedAt)) {
    return 'published_projection_missing_or_mismatched';
  }
  if (publication.moderationStatus !== 'APPROVED' ||
      projection.moderationStatus !== 'APPROVED') {
    return 'moderation_or_legal_review';
  }
  // Referências históricas ainda podem alimentar processamento/sincronização.
  if (typeof publication.sourceStoragePath === 'string' &&
      publication.sourceStoragePath.trim() !== '') {
    return 'live_source_reference';
  }
  if (deletionJob) return 'deletion_job_present';
  if (privateDocument?.feedPublicationPending === true ||
      privateDocument?.feedPublicationCleanupStagedAtMs != null) {
    return 'pending_upload_lifecycle';
  }
  if (privateDocument?.displayDate != null &&
      publication.displayDate === undefined) {
    return 'unmigrated_display_date';
  }

  // Não foram verificados todos os consumidores, reservas, retenções legais,
  // evidências e TOCTOU. Mesmo o caso aparentemente limpo NÃO está liberado.
  return 'legacy_consumers_or_retention_unverified';
}
