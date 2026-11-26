import { Observable, Subscription } from 'rxjs';
import type { IChat } from '@core/interfaces/interfaces-chat/chat.interface';
import type { DirectChatPageState } from './chat-discovery-pages';

export interface DirectChatInboxScope extends DirectChatPageState {
  chats: IChat[];
  unconfirmedCount: number;
}

export const revokedDirectChatInbox = (): DirectChatInboxScope => ({
  ownerUid: null, status: 'revoked', chatIds: [], hasMore: false, chats: [], unconfirmedCount: 0,
});

function canonicalActivity(chat: IChat): [number, number] | null {
  const ts = chat.timestamp;
  return Number.isInteger(ts?.seconds) && Number.isInteger(ts?.nanoseconds)
    ? [ts.seconds, ts.nanoseconds] : null;
}

export function compareDirectChatActivity(a: IChat, b: IChat): number {
  const left = canonicalActivity(a), right = canonicalActivity(b);
  if (left && right) {
    const order = right[0] - left[0] || right[1] - left[1];
    if (order) return order;
  } else if (left || right) return left ? -1 : 1;
  const x = a.id ?? '', y = b.id ?? '';
  // Match the backend's recent DESC and undated legacy ASC order.
  return x === y ? 0 : (x < y ? -1 : 1) * (left && right ? -1 : 1);
}

// Incrementally reconcile listeners; do not tear down unchanged documents
// when another page arrives. Null is never a confirmed readable chat.
export function observeConfirmedDirectChatInbox$(
  owner: string,
  pages$: Observable<DirectChatPageState>,
  observe: (id: string) => Observable<IChat | null>
): Observable<DirectChatInboxScope> {
  return new Observable<DirectChatInboxScope>(sink => {
    const entries = new Map<string, { sub: Subscription; chat: IChat | null }>();
    let page: DirectChatPageState = revokedDirectChatInbox();
    let reconciling = false;
    const emit = () => {
      if (reconciling || sink.closed) return;
      const chats = [...entries.values()].flatMap(entry => entry.chat ? [entry.chat] : [])
        .sort(compareDirectChatActivity);
      sink.next({ ...page, chats, unconfirmedCount: entries.size - chats.length });
    };
    const clear = () => {
      entries.forEach(entry => entry.sub.unsubscribe());
      entries.clear();
    };
    const pagesSub = pages$.subscribe({
      next: value => {
        reconciling = true;
        page = value.ownerUid === owner ? value : revokedDirectChatInbox();
        const ids = new Set(page.status === 'ready' || page.status === 'loading' ? page.chatIds : []);
        for (const [id, entry] of entries) {
          if (!ids.has(id)) { entries.delete(id); entry.sub.unsubscribe(); }
        }
        for (const id of ids) {
          if (entries.has(id)) continue;
          const entry = { sub: new Subscription(), chat: null as IChat | null };
          entries.set(id, entry);
          entry.sub.add(observe(id).subscribe({
            next: chat => {
              if (entries.get(id) !== entry) return;
              const pair = chat?.participants;
              entry.chat = chat?.id === id && !chat.isRoom && Array.isArray(pair) &&
                pair.length === 2 && pair.includes(owner) && pair[0] !== pair[1] &&
                pair.every(uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid))
                ? chat : null;
              emit();
            },
            error: error => sink.error(error),
          }));
        }
        reconciling = false;
        emit();
      },
      error: error => sink.error(error),
      complete: () => sink.complete(),
    });
    return () => { pagesSub.unsubscribe(); clear(); };
  });
}
