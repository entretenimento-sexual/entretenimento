import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { revalidateDiscoveryOnRevision$ } from './chat-discovery-invalidation';

describe('CHAT-R1.6 discovery invalidation', () => {
  it('cancels stale generations, clears immediately, restores without polling', () => {
    const revisions = new Subject<number | null>();
    const old = new Subject<string>();
    const restored = new Subject<string>();
    const observe = vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(restored);
    const next = vi.fn();
    const sub = revalidateDiscoveryOnRevision$(revisions, 'loading', observe).subscribe(next);
    revisions.next(null);
    expect(observe).not.toHaveBeenCalled();
    revisions.next(0);
    old.next('history');
    revisions.next(0);
    expect(observe).toHaveBeenCalledTimes(1);
    revisions.next(1);
    expect(old.observers).toHaveLength(0);
    expect(next.mock.lastCall?.[0]).toBe('loading');
    old.next('stale');
    restored.next('restored');
    expect(next.mock.lastCall?.[0]).toBe('restored');
    revisions.next(null);
    expect(restored.observers).toHaveLength(0);
    expect(next.mock.lastCall?.[0]).toBe('loading');
    sub.unsubscribe();
    expect(revisions.observers).toHaveLength(0);
  });
});
