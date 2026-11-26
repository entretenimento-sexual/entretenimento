import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { IChat } from '@core/interfaces/interfaces-chat/chat.interface';
import type { DirectChatPageState } from './chat-discovery-pages';
import { observeConfirmedDirectChatInbox$, type DirectChatInboxScope } from './chat-inbox-projection';

const chat = (id: string, seconds?: number): IChat => ({
  id, participants: ['owner', 'peer'], timestamp: seconds === undefined
    ? undefined : { seconds, nanoseconds: 0 },
} as IChat);
const page = (chatIds: string[], status: DirectChatPageState['status'] = 'ready'): DirectChatPageState =>
  ({ ownerUid: 'owner', status, chatIds, hasMore: true });

describe('observeConfirmedDirectChatInbox$', () => {
  it('adds pages without restarting confirmed listeners, sorts activity and removes revoked chats', () => {
    const a$ = new BehaviorSubject<IChat | null>(chat('a', 2));
    const b$ = new BehaviorSubject<IChat | null>(chat('b', 1));
    const old$ = new BehaviorSubject<IChat | null>(chat('legacy'));
    const pages$ = new BehaviorSubject(page(['a']));
    const observe = vi.fn((id: string) => id === 'a' ? a$ : id === 'b' ? b$ : old$);
    const values: DirectChatInboxScope[] = [];
    const sub = observeConfirmedDirectChatInbox$('owner', pages$, observe).subscribe(s => values.push(s));
    pages$.next(page(['a', 'b', 'legacy']));
    expect(observe.mock.calls.filter(([id]) => id === 'a')).toHaveLength(1);
    expect(values.at(-1)?.chats.map(c => c.id)).toEqual(['a', 'b', 'legacy']);
    b$.next(chat('b', 3));
    expect(values.at(-1)?.chats.map(c => c.id)).toEqual(['b', 'a', 'legacy']);
    a$.next(null);
    expect(values.at(-1)?.chats.map(c => c.id)).toEqual(['b', 'legacy']);
    expect(values.at(-1)?.unconfirmedCount).toBe(1);
    pages$.next(page([], 'loading'));
    expect(values.at(-1)?.chats).toEqual([]);
    expect(a$.observers).toHaveLength(0);
    expect(b$.observers).toHaveLength(0);
    pages$.next({ ...page(['a']), ownerUid: 'other' });
    expect(values.at(-1)?.ownerUid).toBeNull();
    expect(observe).toHaveBeenCalledTimes(3);
    sub.unsubscribe();
    expect(old$.observers).toHaveLength(0);
  });
});
