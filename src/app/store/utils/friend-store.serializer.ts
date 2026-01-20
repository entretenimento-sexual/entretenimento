// src/app/store/utils/friend-store.serializer.ts
// =============================================================================
// Serialização Friend => Store-safe
// - Store NÃO pode carregar Timestamp (não serializável)
// - Convertemos Timestamp/Date => epoch number via toEpoch()
// =============================================================================

import { environment } from 'src/environments/environment';
import { toEpoch } from '../utils/epoch-utils';
import type { FriendDoc, Friend } from 'src/app/core/interfaces/friendship/friend.interface';

const debug = !environment.production;
const dbg = (msg: string, extra?: unknown) => {
  if (debug) console.log(`[FriendSerializer] ${msg}`, extra ?? '');
};

/** ✅ Converte FriendDoc (Firestore) -> Friend (Store/UI serializável) */
export function sanitizeFriendForStore(d: FriendDoc): Friend {
  const out: Friend = {
    ...d,
    since: toEpoch(d.since),
    lastInteractionAt: toEpoch(d.lastInteractionAt),
  };

  dbg('sanitizeFriendForStore', { in: d, out });
  return out;
}

export function sanitizeFriendsForStore(list: FriendDoc[] | null | undefined): Friend[] {
  const out = (list ?? []).map(sanitizeFriendForStore);
  dbg('sanitizeFriendsForStore', { count: out.length });
  return out;
}
