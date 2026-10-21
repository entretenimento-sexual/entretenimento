import type { DocumentSnapshot } from 'firebase-admin/firestore';

/** Prevents review writes after identity retirement or deletion begins. */
export function isVideoModerationIdentityCurrent(
  ownerUid: string,
  videoId: string,
  identitySnap: DocumentSnapshot,
  deletionSnap: DocumentSnapshot
): boolean {
  return !deletionSnap.exists && (!identitySnap.exists || (
    identitySnap.get('state') === 'REGISTERED' &&
    identitySnap.get('ownerUid') === ownerUid &&
    identitySnap.get('videoId') === videoId
  ));
}
