import { combineLatest, defer, Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, startWith, switchMap } from 'rxjs/operators';
import type { IChat } from '@core/interfaces/interfaces-chat/chat.interface';

export interface ChatDiscoveryScope {
  ownerUid: string | null;
  status: 'loading' | 'ready' | 'revoked' | 'error';
  chats: IChat[];
}

// The transport owns server confirmation. This layer only scopes and shares it.
// It never grants access to an individual conversation or enables messaging.
export function createChatDiscoveryScope$(
  uid$: Observable<string | null>,
  allowed$: Observable<boolean>,
  observe: (uid: string) => Observable<ChatDiscoveryScope>,
  failed: (uid: string, error: unknown) => ChatDiscoveryScope
): Observable<ChatDiscoveryScope> {
  const revoked: ChatDiscoveryScope = { ownerUid: null, status: 'revoked', chats: [] };
  return combineLatest([uid$, allowed$]).pipe(
    map(([uid, allowed]) => allowed && uid && !uid.includes('/') ? uid : null),
    distinctUntilChanged(),
    switchMap(uid => !uid ? of(revoked) : defer(() => observe(uid)).pipe(
      map(scope => {
        if (scope.ownerUid !== uid) return revoked;
        if (scope.status !== 'ready') return { ...scope, chats: [] };
        const chats = scope.chats.filter(chat => chat.id && !chat.isRoom &&
          Array.isArray(chat.participants) && chat.participants.length === 2 &&
          chat.participants.includes(uid) && chat.participants[0] !== chat.participants[1] &&
          chat.participants.every(peer => typeof peer === 'string' && peer.trim() && !peer.includes('/')) &&
          Number.isInteger(chat.timestamp?.seconds) && Number.isInteger(chat.timestamp?.nanoseconds)
        ).sort((a, b) => b.timestamp.seconds - a.timestamp.seconds ||
          b.timestamp.nanoseconds - a.timestamp.nanoseconds || String(b.id).localeCompare(String(a.id)));
        return { ...scope, chats };
      }),
      catchError(error => of(failed(uid, error))),
      startWith({ ownerUid: uid, status: 'loading', chats: [] } as ChatDiscoveryScope)
    )),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
