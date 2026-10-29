/**
 * Contrato puro para copiar SOMENTE data organizacional legada para a
 * publicação canônica. Nunca autoriza limpeza de objetos ou despublicação.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_DATE_MS = 4_133_980_799_999;

export function classifyLegacyPublishedPhotoDate(input) {
  const { ownerUid, photoId, privatePhoto, publication, deletionJob } = input;
  if (!SAFE_ID.test(String(ownerUid ?? '')) ||
      !SAFE_ID.test(String(photoId ?? '')) ||
      !privatePhoto || typeof privatePhoto !== 'object') {
    return 'invalid_legacy_record';
  }
  if (!publication || publication.isPublished !== true ||
      publication.ownerUid !== ownerUid ||
      publication.photoId !== photoId ||
      !['PUBLIC', 'FRIENDS'].includes(publication.visibility)) {
    return 'publication_missing_or_inactive';
  }
  if (deletionJob) return 'deletion_in_progress';
  if (publication.moderationStatus !== 'APPROVED') {
    return 'moderation_protected';
  }
  const pathPrefix = `users/${ownerUid}/published/images/${photoId}/`;
  const finalPath = publication.publishedStoragePath;
  if (typeof finalPath !== 'string' || !finalPath.startsWith(pathPrefix) ||
      !finalPath.slice(pathPrefix.length) ||
      finalPath.slice(pathPrefix.length).includes('/')) {
    return 'invalid_final_publication_path';
  }
  // null é escolha expressa do autor: jamais substituí-la por valor legado.
  if (publication.displayDate !== undefined) {
    return 'already_canonical';
  }
  const date = privatePhoto.displayDate;
  if (typeof date !== 'number' || !Number.isSafeInteger(date) ||
      date < 0 || date > MAX_DATE_MS) {
    return 'no_valid_legacy_date';
  }
  return 'backfill_possible';
}
