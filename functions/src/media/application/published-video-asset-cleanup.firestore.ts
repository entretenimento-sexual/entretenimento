import type { Firestore } from 'firebase-admin/firestore';

interface PublishedAssetToDelete {
  ownerUid: string;
  videoId: string;
  storagePath: string;
  assetKind: 'video' | 'poster';
}

export type PublishedVideoAssetDeletionResult =
  | 'DELETED'
  | 'ACTIVE_REFERENCE';

/**
 * The immutable published asset version is never reused by the publication
 * writer. Check the current Firestore publication before deleting a copy,
 * including when replaying an older cleanup job. Firestore and Storage are
 * not one atomic transaction; this guard relies on unique immutable paths.
 */
export async function deleteUnreferencedPublishedVideoAsset(
  firestore: Firestore,
  command: PublishedAssetToDelete,
  deleteFile: () => Promise<void>
): Promise<PublishedVideoAssetDeletionResult> {
  const snapshot = await firestore.doc(
    `users/${command.ownerUid}/video_publications/${command.videoId}`
  ).get();
  const data = snapshot.exists ? snapshot.data() : null;
  const referenceField = command.assetKind === 'video'
    ? 'publishedStoragePath'
    : 'publishedPosterStoragePath';

  if (data?.['isPublished'] === true &&
    data?.[referenceField] === command.storagePath) {
    return 'ACTIVE_REFERENCE';
  }

  await deleteFile();
  return 'DELETED';
}
