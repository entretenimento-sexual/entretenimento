import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunityFeedTimeTickerService } from './community-feed-time-ticker.service';

describe('CommunityFeedTimeTickerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T15:00:00.000Z'));
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('compartilha um relógio barato que avança a cada 30 segundos', () => {
    const service = TestBed.inject(CommunityFeedTimeTickerService);
    const first: number[] = [];
    const second: number[] = [];
    const firstSubscription = service.now$.subscribe((value) => first.push(value));
    const secondSubscription = service.now$.subscribe((value) => second.push(value));

    vi.advanceTimersByTime(0);
    expect(first).toEqual([Date.now()]);
    expect(second).toEqual([Date.now()]);

    vi.setSystemTime(new Date('2026-08-23T15:00:30.000Z'));
    vi.advanceTimersByTime(30_000);

    expect(first.at(-1)).toBe(Date.now());
    expect(second.at(-1)).toBe(Date.now());
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);

    firstSubscription.unsubscribe();
    secondSubscription.unsubscribe();
  });
});
