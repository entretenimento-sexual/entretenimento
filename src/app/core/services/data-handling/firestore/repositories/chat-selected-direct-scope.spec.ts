import { BehaviorSubject, Subject, of, type Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { IChat } from '@core/interfaces/interfaces-chat/chat.interface';
import type { Message } from '@core/interfaces/interfaces-chat/message.interface';
import type { SharedChatRevision } from './chat-shared-revision';
import { createSelectedDirectChatScope } from './chat-selected-direct-scope';
import { createAuthorizedSharedChatMessages } from './chat-shared-message-window';
import { map } from 'rxjs/operators';

const g = (ownerUid: string | null, revision: number | null): SharedChatRevision => ({ ownerUid, revision });
const chat = (id: string, owner = 'owner'): IChat => ({ id, participants: [owner, 'peer'] } as IChat);
const msg = (id: string): Message[] => [{id} as Message];

describe('selected direct chat live authorization boundary', () => {
  it('joins the already confirmed document after the callable completes, without a second call', () => {
    const generation = g('owner', 1);
    const active$ = new BehaviorSubject(generation);
    const decision = new Subject<boolean>();
    const authorize = vi.fn(() => decision);
    const document = new Subject<IChat | null>();
    const observe = vi.fn(() => document);
    const scope = createSelectedDirectChatScope(active$, authorize, observe);
    const messages = new Subject<Message[]>();
    const watch = vi.fn(() => messages);
    const read = createAuthorizedSharedChatMessages(active$,
      (id, gen) => scope(gen, id).pipe(map(value => value !== null)), watch);
    const selected: (IChat|null)[] = [];
    const header = scope(generation, 'a').subscribe(value => selected.push(value));
    decision.next(true);
    decision.complete();
    expect(watch).not.toHaveBeenCalled();
    document.next(chat('a'));
    const values: Message[][] = [];
    const thread = read('owner', 'a').subscribe(value => values.push(value));
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledTimes(1);
    messages.next(msg('m'));
    expect(values.at(-1)).toEqual(msg('m'));
    document.next(chat('a')); // ordinary document update must not restart the window
    expect(watch).toHaveBeenCalledTimes(1);
    document.next(null); // lost server confirmation within the same generation
    expect(values.at(-1)).toEqual([]);
    expect(messages.observers).toHaveLength(0);
    document.next(chat('a', 'foreign'));
    expect(watch).toHaveBeenCalledTimes(1);
    document.next(chat('a'));
    expect(watch).toHaveBeenCalledTimes(2);
    thread.unsubscribe(); header.unsubscribe();
    expect(document.observers).toHaveLength(0);
    // A later selection starts a new candidate check, even for the same revision.
    const later = scope(generation, 'a').subscribe();
    expect(authorize).toHaveBeenCalledTimes(2);
    later.unsubscribe();
    expect(active$.observers).toHaveLength(0);
  });

  it('never grants access from another chat or generation, even with the same revision number', () => {
    const old = g('owner', 1);
    const active$ = new BehaviorSubject(old);
    const sourceA = new Subject<IChat | null>(), sourceB = new Subject<IChat | null>();
    const authorize = vi.fn(() => of(true));
    const scope = createSelectedDirectChatScope(active$, authorize,
      (_gen, id) => id === 'a' ? sourceA : sourceB);
    const watch = vi.fn(() => new Subject<Message[]>());
    const read = createAuthorizedSharedChatMessages(active$,
      (id, gen) => scope(gen, id).pipe(map(value => value !== null)), watch);
    const header = scope(old, 'a').subscribe();
    sourceA.next(chat('a'));
    const sub = read('owner', 'b').subscribe();
    expect(authorize).toHaveBeenCalledTimes(2);
    sourceB.next(chat('a'));
    expect(watch).not.toHaveBeenCalled();
    sourceB.next(chat('b'));
    expect(watch).toHaveBeenCalledTimes(1);
    active$.next(g(null, null));
    expect(sourceA.observers).toHaveLength(0);
    expect(sourceB.observers).toHaveLength(0);
    const fresh = g('owner', 1);
    active$.next(fresh);
    expect(authorize).toHaveBeenCalledTimes(3);
    const stale = scope(old, 'a').subscribe();
    expect(authorize).toHaveBeenCalledTimes(3);
    sourceB.next(chat('b'));
    expect(watch).toHaveBeenCalledTimes(2);
    stale.unsubscribe(); sub.unsubscribe(); header.unsubscribe();
  });

  it('does not open document or message transport after denial, errors or late revoked checks', () => {
    const generation = g('owner', 1);
    const active$ = new BehaviorSubject(generation);
    const late = new Subject<boolean>();
    const authorize = vi.fn((_id: string): Observable<boolean> => late).mockReturnValueOnce(of(false));
    const observe = vi.fn(() => new Subject<IChat|null>());
    const scope = createSelectedDirectChatScope(active$, authorize, observe);
    const first = scope(generation, 'a').subscribe();
    expect(observe).not.toHaveBeenCalled();
    const second = scope(generation, 'a').subscribe();
    active$.next(g('owner', null));
    late.next(true);
    expect(observe).not.toHaveBeenCalled();
    first.unsubscribe(); second.unsubscribe();
  });
});
