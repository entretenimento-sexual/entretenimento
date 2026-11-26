import { BehaviorSubject, Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@core/interfaces/interfaces-chat/message.interface';
import type { SharedChatRevision } from './chat-shared-revision';
import { createAuthorizedSharedChatMessages } from './chat-shared-message-window';

const scope = (ownerUid: string | null, revision: number | null): SharedChatRevision =>
  ({ ownerUid, revision });
const windowOf = (id: string): Message[] => [{ id } as Message];

describe('createAuthorizedSharedChatMessages', () => {
  it('authorizes each consumer independently before sharing one physical window', () => {
    const active$ = new BehaviorSubject(scope('owner', 2));
    const decisionA = new Subject<boolean>(), decisionB = new Subject<boolean>();
    const decisionC = new Subject<boolean>();
    const authorize = vi.fn((_id: string): import('rxjs').Observable<boolean> => of(false))
      .mockReturnValueOnce(decisionA).mockReturnValueOnce(decisionB).mockReturnValueOnce(decisionC);
    const source = new Subject<Message[]>();
    const observe = vi.fn((_id: string) => source);
    const read = createAuthorizedSharedChatMessages(active$, authorize, observe);
    const a: Message[][] = [], b: Message[][] = [], c: Message[][] = [];
    const first = read('owner', 'chat').subscribe(v => a.push(v));
    expect(observe).not.toHaveBeenCalled();
    decisionA.next(true);
    source.next(windowOf('first'));
    const second = read('owner', 'chat').subscribe(v => b.push(v));
    const denied = read('owner', 'chat').subscribe(v => c.push(v));
    expect(b).toEqual([[]]);
    expect(c).toEqual([[]]);
    decisionC.next(false);
    decisionB.next(true);
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(source.observers).toHaveLength(1);
    expect(b.at(-1)).toEqual(windowOf('first'));
    source.next(windowOf('updated'));
    expect(a.at(-1)).toEqual(windowOf('updated'));
    expect(b.at(-1)).toEqual(windowOf('updated'));
    expect(c).toEqual([[]]);
    first.unsubscribe();
    expect(source.observers).toHaveLength(1);
    second.unsubscribe();
    expect(source.observers).toHaveLength(0);
    denied.unsubscribe();
  });

  it('cancels late decisions and discards old replay after revocation and same-number reauthorization', () => {
    const active$ = new BehaviorSubject(scope('owner', 2));
    const delayed = new Subject<boolean>();
    const authorize = vi.fn((_id: string): import('rxjs').Observable<boolean> => of(true)).mockReturnValueOnce(delayed);
    const old = new Subject<Message[]>(), fresh = new Subject<Message[]>();
    const observe = vi.fn((_id: string) => fresh).mockReturnValueOnce(old);
    const read = createAuthorizedSharedChatMessages(active$, authorize, observe);
    const a: Message[][] = [], b: Message[][] = [];
    const first = read('owner', 'chat').subscribe(v => a.push(v));
    const second = read('owner', 'chat').subscribe(v => b.push(v));
    old.next(windowOf('old'));
    expect(b.at(-1)).toEqual(windowOf('old'));
    active$.next(scope(null, null));
    expect(old.observers).toHaveLength(0);
    expect(delayed.observers).toHaveLength(0);
    expect(b.at(-1)).toEqual([]);
    delayed.next(true);
    old.next(windowOf('late'));
    active$.next(scope('owner', 2));
    expect(observe).toHaveBeenCalledTimes(2);
    expect(a.at(-1)).toEqual([]);
    expect(b.at(-1)).toEqual([]);
    fresh.next(windowOf('fresh'));
    expect(a.at(-1)).toEqual(windowOf('fresh'));
    expect(b.at(-1)).toEqual(windowOf('fresh'));
    active$.next(scope('other', 2));
    expect(fresh.observers).toHaveLength(0);
    expect(a.at(-1)).toEqual([]);
    expect(b.at(-1)).toEqual([]);
    first.unsubscribe();
    second.unsubscribe();
  });

  it('releases replay when the last consumer leaves and reauthorizes a later subscription', () => {
    const active$ = new BehaviorSubject(scope('owner', 2));
    const old = new Subject<Message[]>(), fresh = new Subject<Message[]>();
    const observe = vi.fn((_id: string) => fresh).mockReturnValueOnce(old);
    const authorize = vi.fn((_id: string) => of(true));
    const read = createAuthorizedSharedChatMessages(active$, authorize, observe);
    const first = read('owner', 'chat').subscribe();
    old.next(windowOf('old'));
    first.unsubscribe();
    expect(old.observers).toHaveLength(0);
    const values: Message[][] = [];
    const later = read('owner', 'chat').subscribe(v => values.push(v));
    expect(values).toEqual([[]]);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledTimes(2);
    fresh.next(windowOf('new'));
    expect(values.at(-1)).toEqual(windowOf('new'));
    later.unsubscribe();
  });

  it('keeps transport errors observable and does not reuse a failed window', () => {
    const active$ = new BehaviorSubject(scope('owner', 2));
    const old = new Subject<Message[]>(), fresh = new Subject<Message[]>();
    const observe = vi.fn((_id: string) => fresh).mockReturnValueOnce(old);
    const read = createAuthorizedSharedChatMessages(active$, () => of(true), observe);
    const onError = vi.fn();
    read('owner', 'chat').subscribe({ error: onError });
    old.next(windowOf('old'));
    const error = new Error('permission-denied');
    old.error(error);
    expect(onError).toHaveBeenCalledWith(error);
    const values: Message[][] = [];
    const retry = read('owner', 'chat').subscribe(v => values.push(v));
    expect(values).toEqual([[]]);
    expect(observe).toHaveBeenCalledTimes(2);
    retry.unsubscribe();
  });

  it('does not authorize invalid IDs, another owner or unconfirmed generations', () => {
    const active$ = new BehaviorSubject(scope('owner', null));
    const authorize = vi.fn((_id: string) => of(true));
    const observe = vi.fn((_id: string) => new Subject<Message[]>());
    const read = createAuthorizedSharedChatMessages(active$, authorize, observe);
    const pending = read('owner', 'chat').subscribe();
    const foreign = read('other', 'chat').subscribe();
    expect(authorize).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    active$.next(scope('owner', 1));
    expect(authorize).toHaveBeenCalledTimes(1);
    for (const id of ['', '.', '..', 'a/b', '__reserved__']) read('owner', id).subscribe();
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    pending.unsubscribe();
    foreign.unsubscribe();
  });
});
