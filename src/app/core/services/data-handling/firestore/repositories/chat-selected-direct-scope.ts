import { Observable, defer, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';
import type { IChat } from '@core/interfaces/interfaces-chat/chat.interface';
import type { SharedChatRevision } from './chat-shared-revision';
import { createSharedChatSnapshots } from './chat-shared-snapshots';

function confirmedDirectChat(chat: IChat | null, owner: string, id: string): IChat | null {
  if (!chat || chat.id !== id || chat.isRoom || !Array.isArray(chat.participants)) return null;
  const pair = chat.participants;
  if (pair.length !== 2 || pair[0] === pair[1] || !pair.includes(owner) ||
      pair.some(uid => typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) return null;
  const data = chat as IChat & { conversationType?: unknown; conversationStatus?: unknown };
  const kind = String(data.conversationType ?? '').trim().toLowerCase();
  const status = String(data.conversationStatus ?? '').trim().toLowerCase();
  return (kind && kind !== 'direct') || (status && status !== 'active') ? null : chat;
}

/**
 * One live, authorized selected-conversation scope per generation and chat.
 * A message consumer may join the still-active canonical document listener,
 * not reuse a completed candidate decision. Ref-count zero, termination,
 * error, or generation replacement destroys the scope and its replay.
 * The document and message sources still require server-confirmed Rules reads.
 */
export function createSelectedDirectChatScope(
  active$: Observable<SharedChatRevision>,
  authorize: (id: string, generation: SharedChatRevision) => Observable<boolean>,
  observe: (generation: SharedChatRevision, id: string) => Observable<IChat | null>
): (generation: SharedChatRevision, id: string) => Observable<IChat | null> {
  const scopes = new WeakMap<SharedChatRevision, ReturnType<typeof createSharedChatSnapshots<IChat>>>();
  return (generation, id) => defer(() => {
    const owner = generation.ownerUid;
    if (!owner || generation.revision === null || !id || id.includes('/') ||
        id === '.' || id === '..' || /^__.*__$/.test(id)) return of(null);
    let scope = scopes.get(generation);
    if (!scope) {
      scope = createSharedChatSnapshots<IChat>(active$, chatId =>
        defer(() => authorize(chatId, generation)).pipe(
          take(1),
          switchMap(allowed => allowed === true
            ? observe(generation, chatId).pipe(map(chat => confirmedDirectChat(chat, owner, chatId)))
            : of(null))
        ));
      scopes.set(generation, scope);
    }
    return scope(generation, id);
  });
}
