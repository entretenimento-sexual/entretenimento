import type { Message } from '@core/interfaces/interfaces-chat/message.interface';

interface ChatMessageSnapshot {
  readonly metadata: { readonly fromCache: boolean; readonly hasPendingWrites: boolean };
  readonly docs: readonly { readonly id: string; data(): unknown }[];
  docChanges(): readonly unknown[];
}

// One projector per listener. Never retain document contents or reuse a
// previous server snapshot across a cache interval, error or resubscription.
// null means "no observable change"; [] is an explicit safe empty snapshot.
export function createChatMessageSnapshotProjector():
  (snapshot: ChatMessageSnapshot) => Message[] | null {
  let previous: 'cache' | 'server' | null = null;
  let pending = false;

  return snapshot => {
    if (snapshot.metadata.fromCache) {
      if (previous === 'cache') return null;
      previous = 'cache';
      pending = false;
      return [];
    }

    const pendingWrites = snapshot.metadata.hasPendingWrites;
    const unchanged = previous === 'server' && pending === pendingWrites &&
      snapshot.docChanges().length === 0;
    previous = 'server';
    pending = pendingWrites;
    if (unchanged) return null;

    // Actual document changes, including local pending receipt transitions,
    // must remain observable. Canonical ordering remains in the repository.
    return snapshot.docs.map(doc => ({
      ...(doc.data() as Message), id: doc.id,
    }));
  };
}
