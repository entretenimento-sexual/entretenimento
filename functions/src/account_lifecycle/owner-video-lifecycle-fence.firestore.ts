/**
 * Account lifecycle owns the deletion authority for video mutations.
 * The account document is read in the writer's existing transaction, so a
 * concurrent status change forces Firestore to retry the writer.
 * A completed purge removes users/{uid}, but retains deleted_accounts_audit.
 * No collection query, Transcoder call or independent write occurs here.
 */
import type { Firestore, Transaction } from 'firebase-admin/firestore';

export async function isOwnerDeletingForVideoMutationInTransaction(
  firestore: Firestore,
  transaction: Transaction,
  ownerUid: string
): Promise<boolean> {
  const owner = await transaction.get(firestore.doc('users/' + ownerUid));
  if (owner.exists) {
    const status = owner.get('accountStatus');
    return status === 'pending_deletion' || status === 'deleted';
  }

  // Post-purge protection. For older emulator/legacy records with neither
  // account nor deletion audit, this predicate cannot prove a deletion.
  const tombstone = await transaction.get(
    firestore.collection('deleted_accounts_audit').doc(ownerUid)
  );
  return tombstone.exists;
}
