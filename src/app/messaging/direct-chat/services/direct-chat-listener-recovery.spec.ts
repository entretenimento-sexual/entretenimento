import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { recoverDirectChatListener$ } from './direct-chat-listener-recovery';

describe('recoverDirectChatListener$', () => {
  it('clears stale data and restores only from a new listener', async () => {
    vi.useFakeTimers();
    try {
      const first = new Subject<string[]>();
      const observe = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(of(['restored']));
      const seen: string[][] = [];
      const sub = recoverDirectChatListener$<string[]>(observe, () => [], [1000]).subscribe(v => seen.push(v));
      first.next(['old']);
      first.error({ code: 'permission-denied' });
      expect(seen).toEqual([['old'], []]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(seen).toEqual([['old'], [], ['restored']]);
      sub.unsubscribe();
    } finally { vi.useRealTimers(); }
  });
  it('cancels scheduled recovery on context disposal', async () => {
    vi.useFakeTimers();
    try {
      const observe = vi.fn(() => throwError(() => ({ code: 'permission-denied' })));
      const sub = recoverDirectChatListener$<boolean>(observe, () => false, [1000]).subscribe();
      sub.unsubscribe();
      await vi.advanceTimersByTimeAsync(2000);
      expect(observe).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('bounds attempts and never retries unrelated errors', async () => {
    vi.useFakeTimers();
    try {
      const observe = vi.fn(() => throwError(() => ({ code: 'unavailable' })));
      const seen: boolean[] = [];
      const sub = recoverDirectChatListener$<boolean>(observe, () => false, [1000, 3000]).subscribe(v => seen.push(v));
      await vi.advanceTimersByTimeAsync(10000);
      expect(observe).toHaveBeenCalledTimes(3);
      expect(seen).toEqual([false, false, false]);
      sub.unsubscribe();
      const error = { code: 'invalid-argument' };
      const failed = vi.fn(() => throwError(() => error));
      const onError = vi.fn();
      recoverDirectChatListener$<boolean>(failed, () => false).subscribe({ error: onError });
      expect(onError).toHaveBeenCalledWith(error);
      expect(failed).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
