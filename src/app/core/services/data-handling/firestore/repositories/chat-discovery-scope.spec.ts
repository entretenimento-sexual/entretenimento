import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { createChatDiscoveryScope$, type ChatDiscoveryScope } from './chat-discovery-scope';

const chat = (id: string, uid = 'a', seconds = 1) => ({
  id, participants: [uid, 'peer'], timestamp: new Timestamp(seconds, 0),
});
const ready = (ownerUid: string, chats = [chat('one', ownerUid)]): ChatDiscoveryScope =>
  ({ ownerUid, status: 'ready', chats });

describe('CHAT-R1.4 canonical discovery scope', () => {
  it('shares one transport, clears on UID change and revocation, releases last subscriber', () => {
    const uid = new BehaviorSubject<string | null>('a');
    const allowed = new BehaviorSubject(true);
    const a = new Subject<ChatDiscoveryScope>();
    const b = new Subject<ChatDiscoveryScope>();
    const observe = vi.fn((owner: string) => owner === 'a' ? a : b);
    const scope$ = createChatDiscoveryScope$(uid, allowed, observe,
      ownerUid => ({ ownerUid, status: 'error', chats: [] }));
    const list = vi.fn();
    const unread = vi.fn();
    const first = scope$.subscribe(list);
    const second = scope$.subscribe(unread);
    expect(observe).toHaveBeenCalledTimes(1);
    a.next(ready('a', [chat('old'), chat('new', 'a', 2), chat('foreign', 'c')]));
    expect(list.mock.lastCall?.[0].chats.map((item: { id: string }) => item.id)).toEqual(['new', 'old']);
    expect(unread.mock.lastCall).toEqual(list.mock.lastCall);
    uid.next('b');
    expect(a.observers).toHaveLength(0);
    expect(list.mock.lastCall?.[0]).toEqual({ ownerUid: 'b', status: 'loading', chats: [] });
    b.next(ready('b'));
    allowed.next(false);
    expect(b.observers).toHaveLength(0);
    expect(unread.mock.lastCall?.[0]).toEqual({ ownerUid: null, status: 'revoked', chats: [] });
    allowed.next(true);
    first.unsubscribe();
    expect(b.observers).toHaveLength(1);
    second.unsubscribe();
    expect(b.observers).toHaveLength(0);
  });

  it('clears unconfirmed data and distinguishes failure from confirmed empty', () => {
    const uid = new BehaviorSubject<string | null>('a');
    const transport = new Subject<ChatDiscoveryScope>();
    const failed = vi.fn((ownerUid: string) => ({ ownerUid, status: 'error' as const, chats: [] }));
    const next = vi.fn();
    const sub = createChatDiscoveryScope$(uid, new BehaviorSubject(true), () => transport, failed)
      .subscribe(next);
    transport.next(ready('a', []));
    expect(next.mock.lastCall?.[0].status).toBe('ready');
    transport.next({ ...ready('a'), status: 'loading' });
    expect(next.mock.lastCall?.[0].chats).toEqual([]);
    transport.error(new Error('denied'));
    expect(failed).toHaveBeenCalledTimes(1);
    expect(next.mock.lastCall?.[0]).toEqual({ ownerUid: 'a', status: 'error', chats: [] });
    sub.unsubscribe();
  });
});
