import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GlobalActivityService } from './global-activity.service';

describe('GlobalActivityService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exibe estado lento somente depois do limiar', async () => {
    const service = new GlobalActivityService();
    const operation = new Subject<void>();
    const slowStates: boolean[] = [];
    const subscription = service.isSlow$.subscribe((value) => {
      slowStates.push(value);
    });
    const operationSubscription = service.track$(operation).subscribe();

    expect(slowStates.at(-1)).toBe(false);

    await vi.advanceTimersByTimeAsync(899);
    expect(slowStates.at(-1)).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(slowStates.at(-1)).toBe(true);

    operation.complete();
    expect(slowStates.at(-1)).toBe(false);

    operationSubscription.unsubscribe();
    subscription.unsubscribe();
  });

  it('mantém o contador correto com operações concorrentes', () => {
    const service = new GlobalActivityService();
    const first = new Subject<void>();
    const second = new Subject<void>();
    const counts: number[] = [];
    const countSubscription = service.activeCount$.subscribe((value) => {
      counts.push(value);
    });
    const firstSubscription = service.track$(first).subscribe();
    const secondSubscription = service.track$(second).subscribe();

    expect(counts.at(-1)).toBe(2);

    first.complete();
    expect(counts.at(-1)).toBe(1);

    second.complete();
    expect(counts.at(-1)).toBe(0);

    firstSubscription.unsubscribe();
    secondSubscription.unsubscribe();
    countSubscription.unsubscribe();
  });

  it('libera a atividade quando a inscrição é cancelada', () => {
    const service = new GlobalActivityService();
    const operation = new Subject<void>();
    const counts: number[] = [];
    const countSubscription = service.activeCount$.subscribe((value) => {
      counts.push(value);
    });
    const operationSubscription = service.track$(operation).subscribe();

    expect(counts.at(-1)).toBe(1);
    operationSubscription.unsubscribe();
    expect(counts.at(-1)).toBe(0);

    countSubscription.unsubscribe();
  });
});
