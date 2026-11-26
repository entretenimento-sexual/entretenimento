import { Observable, defer, of } from 'rxjs';
import { distinctUntilChanged, map, startWith, switchMap, take } from 'rxjs/operators';
import type { Message } from '@core/interfaces/interfaces-chat/message.interface';
import type { SharedChatRevision } from './chat-shared-revision';
import { createSharedChatSnapshots } from './chat-shared-snapshots';

// Share only the canonical 60-message transport, never a candidate decision.
// Each subscription must complete its own backend check for the active
// confirmed generation. A new generation cancels the old check AND window.
export function createAuthorizedSharedChatMessages(
  active$: Observable<SharedChatRevision>,
  authorize: (id: string) => Observable<boolean>,
  observe: (id: string) => Observable<Message[]>
): (ownerUid: string, chatId: string) => Observable<Message[]> {
  const read = createSharedChatSnapshots<Message[]>(active$, observe);

  return (ownerUid, chatId) => {
    const owner = String(ownerUid ?? '').trim();
    const id = String(chatId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner) || !id ||
        id.includes('/') || id === '.' || id === '..' || /^__.*__$/.test(id)) {
      return of([]);
    }

    return active$.pipe(
      distinctUntilChanged(),
      switchMap(generation => {
        if (generation.ownerUid !== owner || generation.revision === null) {
          return of([] as Message[]);
        }
        return defer(() => authorize(id)).pipe(
          take(1),
          switchMap(allowed => allowed === true
            ? read(generation, id).pipe(map(messages => messages ?? []))
            : of([] as Message[])),
          // Immediately clear the old window during reauthorization.
          startWith([] as Message[])
        );
      }),
      // Consecutive safe-empty states carry no additional message information.
      distinctUntilChanged((previous, current) =>
        previous.length === 0 && current.length === 0)
    );
  };
}
