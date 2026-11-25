import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { PublicMediaReadBoundaryService, type PublicMediaReadResponse } from './public-media-read-boundary.service';

describe('PublicMediaReadBoundaryService concurrency', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('deduplica somente payload idêntico e não reaproveita resultados após conclusão', async () => {
    const session = {
      currentAuthUser: { uid: 'viewer' },
      uid$: new BehaviorSubject<string | null>('viewer'),
      terminationVersionSnapshot: 0,
      isTerminatingSnapshot: false,
    };
    TestBed.configureTestingModule({ providers: [
      { provide: Functions, useValue: {} },
      { provide: AuthSessionService, useValue: session },
    ] });
    const service = TestBed.inject(PublicMediaReadBoundaryService);
    const page: PublicMediaReadResponse = { items: [], nextCursor: null, hasMore: false, fetchedAt: 1, scanned: 0 };
    let finish!: (value: { data: PublicMediaReadResponse }) => void;
    const load = vi.fn(() => new Promise<{ data: PublicMediaReadResponse }>(resolve => { finish = resolve; }));
    Reflect.set(service, 'callable', load);
    const request = { mediaType: 'PHOTO', mode: 'LATEST', limit: 12 } as const;
    const first = firstValueFrom(service.read$(request));
    const second = firstValueFrom(service.read$({ ...request }));
    expect(load).toHaveBeenCalledTimes(1);
    load.mockResolvedValueOnce({ data: page });
    await firstValueFrom(service.read$({ ...request, mediaType: 'VIDEO' }));
    expect(load).toHaveBeenCalledTimes(2);
    finish({ data: page });
    expect(await Promise.all([first, second])).toEqual([page, page]);
    load.mockResolvedValueOnce({ data: page });
    await firstValueFrom(service.read$(request));
    expect(load).toHaveBeenCalledTimes(3);
  });
});
