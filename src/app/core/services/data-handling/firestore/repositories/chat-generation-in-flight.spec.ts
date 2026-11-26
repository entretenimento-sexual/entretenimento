import { BehaviorSubject, Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { createChatGenerationInFlight } from './chat-generation-in-flight';
import type { SharedChatRevision } from './chat-shared-revision';

const generation = (ownerUid: string | null, revision: number | null): SharedChatRevision =>
  ({ ownerUid, revision });

describe('createChatGenerationInFlight', () => {
  it('coalesces 24 overlapping reads into one source but never caches a completed result', () => {
    const g = generation('owner', 1);
    const active$ = new BehaviorSubject(g);
    const source = new Subject<boolean>();
    const load = vi.fn(() => source);
    const read = createChatGenerationInFlight<boolean>(active$);
    const values: boolean[] = [];
    for (let i = 0; i < 24; i++) read(g, 'same', load).subscribe(value => values.push(value));
    expect(load).toHaveBeenCalledTimes(1);
    expect(source.observers).toHaveLength(1);
    source.next(true);
    expect(values).toEqual(Array(24).fill(true));
    expect(source.observers).toHaveLength(0);
    const later = vi.fn(() => of(false));
    read(g, 'same', later).subscribe(value => values.push(value));
    expect(later).toHaveBeenCalledTimes(1);
    expect(values.at(-1)).toBe(false);
  });

  it('separates keys, rejects stale generation objects and cancels late responses on revoke', () => {
    const g = generation('owner', 1);
    const active$ = new BehaviorSubject(g);
    const a = new Subject<string>(), b = new Subject<string>();
    const read = createChatGenerationInFlight<string>(active$);
    const values: string[] = [];
    read(g, 'a', () => a).subscribe(v => values.push(v));
    read(g, 'b', () => b).subscribe(v => values.push(v));
    expect(a.observers).toHaveLength(1);
    expect(b.observers).toHaveLength(1);
    active$.next(generation(null, null));
    expect(a.observers).toHaveLength(0);
    expect(b.observers).toHaveLength(0);
    const fresh = generation('owner', 1);
    active$.next(fresh);
    const forbidden = vi.fn(() => of('stale'));
    read(g, 'a', forbidden).subscribe(v => values.push(v));
    expect(forbidden).not.toHaveBeenCalled();
    a.next('late'); b.next('late');
    read(fresh, 'a', () => of('fresh')).subscribe(v => values.push(v));
    expect(values).toEqual(['fresh']);
  });

  it('does not reuse failures or unconfirmed requests and releases abandoned sources', () => {
    const g = generation('owner', 1);
    const active$ = new BehaviorSubject(g);
    const read = createChatGenerationInFlight<boolean>(active$);
    const source = new Subject<boolean>();
    const onError = vi.fn();
    read(g, 'key', () => source).subscribe({error:onError});
    const error = new Error('resource-exhausted');
    source.error(error);
    expect(onError).toHaveBeenCalledWith(error);
    const next = new Subject<boolean>();
    const sub = read(g, 'key', () => next).subscribe();
    sub.unsubscribe();
    expect(next.observers).toHaveLength(0);
    const fresh = vi.fn(() => of(true));
    read(g, 'key', fresh).subscribe();
    expect(fresh).toHaveBeenCalledTimes(1);
    const unknown = generation('owner', null);
    active$.next(unknown);
    read(unknown, 'key', fresh).subscribe();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('reentrant reads after a response start a fresh backend request', () => {
    const g = generation('owner', 1);
    const active$ = new BehaviorSubject(g);
    const read = createChatGenerationInFlight<boolean>(active$);
    const first = new Subject<boolean>();
    const second = vi.fn(() => of(false));
    const values: boolean[] = [];
    read(g, 'key', () => first).subscribe(v => {
      values.push(v);
      read(g, 'key', second).subscribe(result => values.push(result));
    });
    first.next(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(values).toEqual([true, false]);
  });
});
