/** Check the current canonical state before acting on a historical event.
 * A published video is never purged. An explicitly unpublished publication
 * remains eligible for legacy cleanup, including when its identity is registered.
 * An absent publication requires a retirement/deletion fence.
 */
export function canCleanupUnpublishedVideoInteractions(input: {
  isPublished: unknown;
  identityState: unknown;
  deletionRequested: boolean;
  publicationExists: boolean;
}): boolean {
  if (input.isPublished === true) return false;
  if (input.publicationExists) return input.isPublished === false;
  const state = String(input.identityState ?? '').trim().toUpperCase();
  return state === 'RETIRED' || input.deletionRequested && state !== 'REGISTERED';
}
