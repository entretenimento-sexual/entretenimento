import { Subject, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DirectReceiptWriteQueue } from './direct-receipt-write-queue';

describe('DirectReceiptWriteQueue', () => {
  it('admits FIFO, limits waiting jobs and releases slots on errors', async () => {
    const queue = new DirectReceiptWriteQueue(1, 2);
    const first = new Subject<number>();
    const started: string[] = [];
    const errors = vi.fn();
    queue.schedule$(() => first).subscribe({ error: errors });
    const a = firstValueFrom(queue.schedule$(() => {
      started.push('a');
      return of(1);
    }));
    const b = firstValueFrom(queue.schedule$(() => {
      started.push('b');
      return of(2);
    }));
    const dropped = vi.fn(() => of(3));
    const completed = vi.fn();
    queue.schedule$(dropped).subscribe({ complete: completed });
    expect(dropped).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledOnce();
    expect(started).toEqual([]);
    const error = new Error('transport');
    first.error(error);
    expect(errors).toHaveBeenCalledWith(error);
    expect(await a).toBe(1);
    expect(await b).toBe(2);
    expect(started).toEqual(['a', 'b']);
  });

  it('removes queued cancellations and defers draining until sibling teardowns finish', async () => {
    const queue = new DirectReceiptWriteQueue(1, 10);
    const pending = new Subject<number>();
    const first = queue.schedule$(() => pending).subscribe();
    const stale = vi.fn(() => of(1));
    const second = queue.schedule$(stale).subscribe();
    const fresh = vi.fn(() => of(2));
    const third = firstValueFrom(queue.schedule$(fresh));
    first.unsubscribe();
    second.unsubscribe();
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).not.toHaveBeenCalled();
    expect(await third).toBe(2);
    expect(stale).not.toHaveBeenCalled();
    expect(pending.observers).toHaveLength(0);
  });

  it('handles synchronous source failure without losing a slot', async () => {
    const queue = new DirectReceiptWriteQueue(1, 10);
    const error = new Error('sync');
    await expect(firstValueFrom(queue.schedule$(() => { throw error; }))).rejects.toBe(error);
    await expect(firstValueFrom(queue.schedule$(() => throwError(() => error)))).rejects.toBe(error);
    expect(await firstValueFrom(queue.schedule$(() => of(42)))).toBe(42);
  });
});
