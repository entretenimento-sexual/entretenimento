import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { observeDirectChatPages$, type DirectChatPageResponse, type DirectChatPageState } from './chat-discovery-pages';

const token = (char: string) => char.repeat(43);
const page = (chatIds: string[], nextCursor: string | null, revision = 1): DirectChatPageResponse =>
  ({ chatIds, nextCursor, revision });

describe('observeDirectChatPages$', () => {
  it('continues empty windows, deduplicates IDs and stops at exhaustion', () => {
    const more$ = new Subject<void>();
    const fetch = vi.fn((cursor: string | null) => of(cursor === null
      ? page([], token('a'))
      : cursor === token('a') ? page(['first'], token('b')) : page(['first', 'second'], null)));
    const states: DirectChatPageState[] = [];
    const sub = observeDirectChatPages$('owner', of(1), more$, fetch, vi.fn()).subscribe(s => states.push(s));
    expect(states.at(-1)).toMatchObject({ status: 'ready', chatIds: [], hasMore: true });
    more$.next();
    expect(states.at(-1)).toMatchObject({ chatIds: ['first'], hasMore: true });
    more$.next();
    expect(states.at(-1)).toMatchObject({ chatIds: ['first', 'second'], hasMore: false });
    more$.next();
    expect(fetch).toHaveBeenCalledTimes(3);
    sub.unsubscribe();
  });

  it('cancels late pages on revision changes and rejects concurrent load requests', () => {
    const revision$ = new BehaviorSubject<number | null>(1);
    const more$ = new Subject<void>();
    const first$ = new Subject<DirectChatPageResponse>();
    const next$ = new Subject<DirectChatPageResponse>();
    const fetch = vi.fn().mockReturnValueOnce(first$).mockReturnValueOnce(next$);
    const states: DirectChatPageState[] = [];
    const sub = observeDirectChatPages$('owner', revision$, more$, fetch, vi.fn()).subscribe(s => states.push(s));
    more$.next();
    expect(fetch).toHaveBeenCalledTimes(1);
    revision$.next(null);
    expect(first$.observers).toHaveLength(0);
    expect(states.at(-1)).toMatchObject({ status: 'loading', chatIds: [] });
    first$.next(page(['stale'], null));
    revision$.next(2);
    expect(fetch).toHaveBeenLastCalledWith(null);
    next$.next(page(['fresh'], null, 2));
    expect(states.at(-1)).toMatchObject({ status: 'ready', chatIds: ['fresh'] });
    sub.unsubscribe();
    expect(next$.observers).toHaveLength(0);
  });

  it('clears authorized IDs on errors and restarts from the first page', () => {
    const more$ = new Subject<void>();
    const report = vi.fn();
    const fetch = vi.fn().mockReturnValueOnce(of(page(['first'], token('a'))))
      .mockReturnValueOnce(throwError(() => new Error('expired')))
      .mockReturnValueOnce(of(page(['fresh'], null)));
    const states: DirectChatPageState[] = [];
    const sub = observeDirectChatPages$('owner', of(1), more$, fetch, report).subscribe(s => states.push(s));
    more$.next();
    expect(states.at(-1)).toMatchObject({ status: 'error', chatIds: [] });
    expect(report).toHaveBeenCalledTimes(1);
    more$.next();
    expect(fetch).toHaveBeenLastCalledWith(null);
    expect(states.at(-1)).toMatchObject({ status: 'ready', chatIds: ['fresh'] });
    sub.unsubscribe();
  });

  it('rejects incorrect revisions and repeated cursors without exposing IDs', () => {
    const more$ = new Subject<void>();
    const report = vi.fn();
    const fetch = vi.fn().mockReturnValueOnce(of(page(['wrong'], null, 2)))
      .mockReturnValueOnce(of(page(['first'], token('a'))))
      .mockReturnValueOnce(of(page(['wrong'], token('a'))));
    const states: DirectChatPageState[] = [];
    const sub = observeDirectChatPages$('owner', of(1), more$, fetch, report).subscribe(s => states.push(s));
    expect(states.at(-1)).toMatchObject({ status: 'error', chatIds: [] });
    more$.next();
    more$.next();
    expect(states.at(-1)).toMatchObject({ status: 'error', chatIds: [] });
    expect(report).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });
});
