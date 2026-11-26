import { FieldValue } from '../../firebaseApp';

/**
 * Private, direction-specific invalidation only. The caller must already
 * have read the two canonical user documents in the transaction. Never
 * recreate a deleted account or publish relationship identifiers.
 */
export function stagePendingFriendRequestInvalidation(
  tx: FirebaseFirestore.Transaction,
  requester: FirebaseFirestore.DocumentSnapshot,
  target: FirebaseFirestore.DocumentSnapshot
): void {
  if (requester.exists) {
    tx.update(requester.ref, {
      pendingFriendRequestsOutboundRevision: FieldValue.increment(1),
    });
  }
  if (target.exists) {
    tx.update(target.ref, {
      pendingFriendRequestsInboundRevision: FieldValue.increment(1),
    });
  }
}
