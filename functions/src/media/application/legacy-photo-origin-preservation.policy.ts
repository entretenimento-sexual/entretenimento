import { extractOwnedPrivatePhotoPath, normalizeOwnedPublishedPhotoPath } from './photo-storage-path';

/**
 * The original technical upload is NOT the authority of a published photo.
 * Its absence may never authorize deletion of a live publication.
 *
 * A confirmed active publication is protected even if its projection is
 * delayed, its moderation changed, or its legacy source is missing.
 * Inspections do not authorize physical deletion; a separate generation-
 * pinned job must prove all references and retention guards before cleanup.
 */
export function classifyLegacyPhotoOrigin(input: {
  ownerUid: string;
  photoId: string;
  privateSourcePath: unknown;
  publication: Record<string, unknown> | null;
  sourceExists: boolean;
}): 'unpublished' | 'published_final_exists' |
    'published_source_missing' | 'published_needs_review' {
  const publication = input.publication;
  if (!publication || publication['isPublished'] !== true) return 'unpublished';

  const finalPath = normalizeOwnedPublishedPhotoPath(
    input.ownerUid, input.photoId, publication['publishedStoragePath']
  );
  const sourcePath = extractOwnedPrivatePhotoPath(
    input.ownerUid, input.privateSourcePath
  );

  if (!finalPath || !sourcePath ||
      publication['ownerUid'] !== input.ownerUid ||
      publication['photoId'] !== input.photoId ||
      !['PUBLIC', 'FRIENDS'].includes(String(publication['visibility'] ?? ''))) {
    return 'published_needs_review';
  }
  // Do not infer that the final object actually exists from its Firestore path.
  return input.sourceExists
    ? 'published_final_exists' : 'published_source_missing';
}

export function isPublicationPresentAndProtected(
  publication: Record<string, unknown> | null
): boolean {
  // Moderation/quarantine intentionally does not affect this guard.
  return !!publication && publication['isPublished'] === true;
}
