import type { Firestore } from 'firebase-admin/firestore';

export type PhotoDeletionIdentity = {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  createdAt: number;
};

/** Finalize only the exact obligation whose physical deletion succeeded. */
export async function finalizePhotoDeletionJob(
  firestore: Firestore,
  jobId: string,
  identity: PhotoDeletionIdentity
): Promise<boolean> {
  const ref = firestore.collection('media_photo_deletion_jobs').doc(jobId);
  return firestore.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!current.exists) return false;
    if (current.get('ownerUid') !== identity.ownerUid ||
        current.get('photoId') !== identity.photoId ||
        current.get('storagePath') !== identity.storagePath ||
        current.get('createdAt') !== identity.createdAt) {
      throw new Error('photo-deletion-job-identity-changed');
    }
    tx.delete(ref);
    return true;
  });
}
