import { BehaviorSubject, Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { IChat } from '@core/interfaces/interfaces-chat/chat.interface';
import type { DirectChatPageResponse } from './chat-discovery-pages';
import { observeSharedDirectChatInbox$, type DirectChatInboxScope } from './chat-inbox-projection';
import type { SharedChatRevision } from './chat-shared-revision';
import { createSharedChatSnapshots } from './chat-shared-snapshots';

const scope = (ownerUid: string | null, revision: number | null): SharedChatRevision =>
  ({ ownerUid, revision });
const chat = (id: string, seconds: number): IChat => ({
  id, participants: ['owner', 'peer'], timestamp: { seconds, nanoseconds: 0 },
} as IChat);
const cursor = 'a'.repeat(43);
const page = (chatIds: string[], nextCursor: string | null = null, revision = 1): DirectChatPageResponse =>
  ({ chatIds, nextCursor, revision });

describe('observeSharedDirectChatInbox$', () => {
  it('shares authorized snapshots across three consumers and preserves listeners on pagination', () => {
    const generation = scope('owner', 1);
    const active$ = new BehaviorSubject(generation);
    const more$ = new Subject<void>();
    const a$ = new Subject<IChat | null>(), b$ = new Subject<IChat | null>();
    const transport = vi.fn((id: string) => id === 'a' ? a$ : b$);
    const read = createSharedChatSnapshots(active$, transport);
    const legacy = read(generation, 'a').subscribe();
    const selected = read(generation, 'a').subscribe();
    const first$ = new Subject<DirectChatPageResponse>();
    const fetch = vi.fn((token: string | null) => token === null ? first$ : of(page(['a', 'b'])));
    const values: DirectChatInboxScope[] = [];
    const inbox = observeSharedDirectChatInbox$('owner', active$, more$, fetch, read, vi.fn())
      .subscribe(value => values.push(value));

    a$.next(chat('a', 2));
    expect(values.at(-1)?.chats).toEqual([]);
    first$.next(page(['a'], cursor));
    first$.complete();
    expect(values.at(-1)?.chats.map(c => c.id)).toEqual(['a']);
    expect(transport.mock.calls).toEqual([['a']]);
    expect(a$.observers).toHaveLength(1);
    more$.next();
    b$.next(chat('b', 3));
    expect(values.at(-1)?.chats.map(c => c.id)).toEqual(['b', 'a']);
    expect(transport.mock.calls).toEqual([['a'], ['b']]);
    expect(fetch.mock.calls).toEqual([[null, generation], [cursor, generation]]);
    a$.next(null);
    expect(values.at(-1)?.chats.map(c => c.id)).toEqual(['b']);
    expect(values.at(-1)?.unconfirmedCount).toBe(1);
    inbox.unsubscribe();
    expect(b$.observers).toHaveLength(0);
    expect(a$.observers).toHaveLength(1);
    legacy.unsubscribe();
    selected.unsubscribe();
    expect(a$.observers).toHaveLength(0);
  });

  it('drops late pages and cached snapshots across revoked and same-number generations', () => {
    const original = scope('owner', 1);
    const active$ = new BehaviorSubject(original);
    const more$ = new Subject<void>();
    const oldPage$ = new Subject<DirectChatPageResponse>();
    const newPage$ = new Subject<DirectChatPageResponse>();
    const oldChat$ = new Subject<IChat | null>(), newChat$ = new Subject<IChat | null>();
    const transport = vi.fn((_id: string) => newChat$).mockReturnValueOnce(oldChat$);
    const read = createSharedChatSnapshots(active$, transport);
    const legacy = read(original, 'a').subscribe();
    oldChat$.next(chat('a', 1));
    const fetch = vi.fn((_cursor: string | null) => newPage$).mockReturnValueOnce(oldPage$);
    const values: DirectChatInboxScope[] = [];
    const inbox = observeSharedDirectChatInbox$('owner', active$, more$, fetch, read, vi.fn())
      .subscribe(value => values.push(value));
    active$.next(scope('owner', null));
    expect(oldPage$.observers).toHaveLength(0);
    expect(oldChat$.observers).toHaveLength(0);
    expect(values.at(-1)).toMatchObject({ status: 'loading', chats: [] });
    active$.next(scope(null, null));
    expect(values.at(-1)).toMatchObject({ status: 'revoked', ownerUid: null, chats: [] });
    oldPage$.next(page(['a']));
    const fresh = scope('owner', 1);
    active$.next(fresh);
    expect(fetch.mock.calls).toEqual([[null, original], [null, fresh]]);
    newPage$.next(page(['a']));
    newPage$.complete();
    expect(values.at(-1)?.chats).toEqual([]);
    oldChat$.next(chat('a', 9));
    expect(values.at(-1)?.chats).toEqual([]);
    newChat$.next(chat('a', 3));
    expect(values.at(-1)?.chats.map(c => c.id)).toEqual(['a']);
    active$.next(scope('other', 1));
    expect(values.at(-1)).toMatchObject({ status: 'revoked', chats: [] });
    expect(newChat$.observers).toHaveLength(0);
    legacy.unsubscribe();
    inbox.unsubscribe();
  });

  it('rejects a mismatched backend revision even if another consumer has the document', () => {
    const generation = scope('owner', 1);
    const active$ = new BehaviorSubject(generation);
    const transport$ = new Subject<IChat | null>();
    const read = createSharedChatSnapshots(active$, vi.fn((_id: string) => transport$));
    const legacy = read(generation, 'a').subscribe();
    transport$.next(chat('a', 1));
    const report = vi.fn();
    const observe = vi.fn(read);
    const values: DirectChatInboxScope[] = [];
    const inbox = observeSharedDirectChatInbox$('owner', active$, new Subject<void>(),
      () => of(page(['a'], null, 2)), observe, report).subscribe(value => values.push(value));
    expect(values.at(-1)).toMatchObject({ status: 'error', chats: [] });
    expect(observe).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    inbox.unsubscribe();
    legacy.unsubscribe();
  });
});
