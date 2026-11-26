import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { SharedChatRevision } from './chat-shared-revision';
import { createSharedChatSnapshots } from './chat-shared-snapshots';

const scope = (ownerUid: string | null, revision: number | null): SharedChatRevision =>
  ({ ownerUid, revision });

describe('createSharedChatSnapshots', () => {
  it('shares one listener for the same confirmed generation and chat; releases replay on teardown', () => {
    const generation = scope('owner', 3);
    const active$ = new BehaviorSubject(generation);
    const source$ = new Subject<string | null>();
    const observe = vi.fn((_id: string) => source$);
    const read = createSharedChatSnapshots(active$, observe);
    const a: (string | null)[] = [], b: (string | null)[] = [];
    const first = read(generation, 'chat').subscribe(value => a.push(value));
    source$.next('confirmed');
    const second = read(generation, 'chat').subscribe(value => b.push(value));
    expect(observe).toHaveBeenCalledTimes(1);
    expect(source$.observers).toHaveLength(1);
    expect(b.at(-1)).toBe('confirmed');
    source$.next(null);
    expect(a.at(-1)).toBeNull();
    expect(b.at(-1)).toBeNull();
    first.unsubscribe();
    expect(source$.observers).toHaveLength(1);
    second.unsubscribe();
    expect(source$.observers).toHaveLength(0);
    const third = read(generation, 'chat').subscribe(value => b.push(value));
    expect(observe).toHaveBeenCalledTimes(2);
    expect(b.at(-1)).toBeNull();
    third.unsubscribe();
  });

  it('invalidates existing and late consumers and isolates a new generation with the same numeric revision', () => {
    const old = scope('owner', 3);
    const active$ = new BehaviorSubject(old);
    const source$ = new Subject<string | null>();
    const newSource$ = new Subject<string | null>();
    const observe = vi.fn((_id: string) => source$).mockReturnValueOnce(source$).mockReturnValueOnce(newSource$);
    const read = createSharedChatSnapshots(active$, observe);
    const a: (string | null)[] = [], b: (string | null)[] = [];
    const first = read(old, 'chat').subscribe(value => a.push(value));
    source$.next('old');
    active$.next(scope(null, null));
    expect(source$.observers).toHaveLength(0);
    expect(a.at(-1)).toBeNull();
    const fresh = scope('owner', 3);
    active$.next(fresh);
    const stale = read(old, 'chat').subscribe(value => b.push(value));
    expect(observe).toHaveBeenCalledTimes(1);
    expect(b.every(value => value === null)).toBe(true);
    const current = read(fresh, 'chat').subscribe(value => b.push(value));
    expect(b.at(-1)).toBeNull();
    source$.next('late old value');
    expect(b.at(-1)).toBeNull();
    newSource$.next('fresh');
    expect(b.at(-1)).toBe('fresh');
    expect(a.at(-1)).toBeNull();
    active$.next(scope('another-owner', 3));
    expect(newSource$.observers).toHaveLength(0);
    expect(b.at(-1)).toBeNull();
    first.unsubscribe();
    stale.unsubscribe();
    current.unsubscribe();
  });

  it('isolates chat IDs and never replays after an error', () => {
    const generation = scope('owner', 1);
    const active$ = new BehaviorSubject(generation);
    const a$ = new Subject<string | null>();
    const b$ = new Subject<string | null>();
    const fresh$ = new Subject<string | null>();
    const observe = vi.fn((_id: string) => fresh$)
      .mockReturnValueOnce(a$).mockReturnValueOnce(b$);
    const read = createSharedChatSnapshots(active$, observe);
    const values: (string | null)[] = [];
    const onError = vi.fn();
    read(generation, 'a').subscribe({ error: onError });
    const other = read(generation, 'b').subscribe(value => values.push(value));
    a$.next('a');
    expect(values.at(-1)).toBeNull();
    b$.next('b');
    const error = new Error('transport');
    a$.error(error);
    expect(onError).toHaveBeenCalledWith(error);
    const retryValues: (string | null)[] = [];
    const retry = read(generation, 'a').subscribe(value => retryValues.push(value));
    expect(retryValues.at(-1)).toBeNull();
    expect(observe.mock.calls).toEqual([['a'], ['b'], ['a']]);
    expect(values.at(-1)).toBe('b');
    retry.unsubscribe();
    other.unsubscribe();
  });

  it('never starts a listener for an unconfirmed generation', () => {
    const generation = scope('owner', null);
    const active$ = new BehaviorSubject(generation);
    const observe = vi.fn((_id: string) => new Subject<string | null>());
    const values: (string | null)[] = [];
    const sub = createSharedChatSnapshots(active$, observe)(generation, 'chat')
      .subscribe(value => values.push(value));
    expect(observe).not.toHaveBeenCalled();
    expect(values.every(value => value === null)).toBe(true);
    sub.unsubscribe();
  });
});
