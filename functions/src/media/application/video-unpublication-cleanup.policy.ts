/** A stale Firestore trigger must not delete the interactions of an active video.
 * Permanent RETIRED identity fencing makes a later generation with the same ID
 * invalid; deletion jobs also cover legacy records that lack a guard.
 */
export function canCleanupUnpublishedVideoInteractions(input: {
  isPublished: unknown;
  identityState: unknown;
  deletionRequested: boolean;
}): boolean {
  if (input.isPublished === true) return false;
  const state = String(input.identityState ?? '').trim().toUpperCase();
  if (state === 'REGISTERED') return false;
  return state === 'RETIRED' || input.deletionRequested;
}
