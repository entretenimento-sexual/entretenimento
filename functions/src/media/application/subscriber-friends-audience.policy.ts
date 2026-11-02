import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../firebaseApp';
import { hasMinimumActiveDiscoveryPlan } from '../../discovery/discovery-subscription-access';

/**
 * PUBLIC permanece disponível para perfis gratuitos. A publicação nova
 * direcionada apenas a amigos é capacidade de conta assinante elegível.
 * Nunca converte ou revela mídias legadas. Autoridade exclusivamente server-side.
 */
export function canCreateFriendsOnlyPublication(
  owner: Record<string, unknown> | null | undefined,
  visibility: unknown,
  now = Date.now()
): boolean {
  if (visibility !== 'FRIENDS') return visibility === 'PUBLIC';
  return !!owner && hasMinimumActiveDiscoveryPlan(owner, 'basic', now);
}

export async function assertNewRestrictedMediaAudienceEntitlement(
  ownerUid: string,
  visibility: unknown
): Promise<void> {
  if (visibility !== 'FRIENDS') return;
  const snapshot = await db.doc(`users/${ownerUid}`).get();
  if (!snapshot.exists || !canCreateFriendsOnlyPublication(
    snapshot.data() as Record<string, unknown>, visibility
  )) {
    throw new HttpsError('failed-precondition',
      'A audiência Amigos exige assinatura ativa. Você pode escolher Público sem alterar mídias existentes.');
  }
}
