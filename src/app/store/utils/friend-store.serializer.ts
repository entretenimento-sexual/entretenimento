// src/app/store/utils/friend-store.serializer.ts
// =============================================================================
// Serialização Friend => Store-safe
//
// Responsabilidade:
// - converter documentos de amizade vindos do Firestore para objetos seguros
//   para Store/UI;
// - remover valores não serializáveis, como Timestamp;
// - manter a função pura, previsível e sem efeitos colaterais.
//
// Importante:
// - este arquivo NÃO deve usar console.log;
// - este arquivo NÃO deve depender de services Angular;
// - debug operacional deve ficar no repo/facade/service chamador, via
//   PrivacyDebugLoggerService e flag DEBUG_FRIENDS.
// =============================================================================

import { toEpoch } from '../../core/utils/epoch-utils';
import type {
  FriendDoc,
  Friend,
} from 'src/app/core/interfaces/friendship/friend.interface';

/**
 * Converte FriendDoc, vindo do Firestore, para Friend serializável.
 *
 * Por que isso existe:
 * - Firestore Timestamp não é ideal para Store/cache;
 * - a Store deve receber dados simples e serializáveis;
 * - since e lastInteractionAt viram epoch number | null.
 */
export function sanitizeFriendForStore(d: FriendDoc): Friend {
  return {
    ...d,
    since: toEpoch(d.since),
    lastInteractionAt: toEpoch(d.lastInteractionAt),
  };
}

/**
 * Converte lista de FriendDoc para lista segura para Store/UI.
 *
 * Mantém tolerância para null/undefined porque alguns fluxos reativos
 * podem emitir vazio durante bootstrap, logout ou bloqueio de realtime.
 */
export function sanitizeFriendsForStore(
  list: FriendDoc[] | null | undefined
): Friend[] {
  return (list ?? []).map(sanitizeFriendForStore);
}