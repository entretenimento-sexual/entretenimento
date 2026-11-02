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
  if (!owner || owner['isSubscriber'] !== true) return false;
  // Roles administrativos não são, por si, direitos financeiros.
  const plan = String(owner['tier'] ?? owner['role'] ?? '').trim().toLowerCase();
  if (plan !== 'basic' && plan !== 'premium' && plan !== 'vip') return false;
  return hasMinimumActiveDiscoveryPlan(owner, 'basic', now);
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

/** Titular retém leitura dos próprios arquivos, mas terceiros perdem o
 * acesso restrito quando a assinatura do proprietário expira. */
export function canIssueFriendsMediaAccess(input: {
  viewerIsOwner: boolean;
  viewerIsFriend: boolean;
  ownerHasFriendsEntitlement: boolean;
}): boolean {
  return input.viewerIsOwner ||
    (input.viewerIsFriend && input.ownerHasFriendsEntitlement);
}
