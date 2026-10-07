import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { BehaviorSubject, Subject } from 'rxjs';
import type { IPublicVideoAccess, IPublicVideoProjection } from 'src/app/core/interfaces/media/i-public-video-item';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import { PublicVideoAccessService } from './public-video-access.service';
import { PublicVideoOwnerEnrichmentService } from './public-video-owner-enrichment.service';

describe('PublicVideoAccessService / session lifecycle', () => {
  it('limpa acesso temporário e refresh in-flight ao trocar A por B', () => {
    const uid$ = new BehaviorSubject<string | null>('viewer-a');

    TestBed.configureTestingModule({
      providers: [
        PublicVideoAccessService,
        {
          provide: Functions,
          useValue: {},
        },
        {
          provide: FirestoreContextService,
          useValue: {},
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: uid$.asObservable(),
          },
        },
        {
          provide: MediaApplicationErrorService,
          useValue: {
            reportSilently: vi.fn(),
          },
        },
        {
          provide: PublicVideoOwnerEnrichmentService,
          useValue: {},
        },
      ],
    });

    const service = TestBed.inject(PublicVideoAccessService);
    const internal = service as unknown as {
      accessCache: Map<string, unknown>;
      inFlightRefreshes: Map<string, unknown>;
    };

    internal.accessCache.set('viewer-a:video-1', {
      url: 'https://example.test/a',
    });
    internal.inFlightRefreshes.set('owner:video-2', {});

    expect(internal.accessCache.size).toBe(1);
    expect(internal.inFlightRefreshes.size).toBe(1);

    uid$.next('viewer-b');

    expect(internal.accessCache.size).toBe(0);
    expect(internal.inFlightRefreshes.size).toBe(0);
  });

  it('não limpa estruturas quando o UID permanece o mesmo', () => {
    const uid$ = new BehaviorSubject<string | null>('viewer-a');

    TestBed.configureTestingModule({
      providers: [
        PublicVideoAccessService,
        { provide: Functions, useValue: {} },
        { provide: FirestoreContextService, useValue: {} },
        {
          provide: AuthSessionService,
          useValue: { uid$: uid$.asObservable() },
        },
        {
          provide: MediaApplicationErrorService,
          useValue: { reportSilently: vi.fn() },
        },
        {
          provide: PublicVideoOwnerEnrichmentService,
          useValue: {},
        },
      ],
    });

    const service = TestBed.inject(PublicVideoAccessService);
    const internal = service as unknown as {
      accessCache: Map<string, unknown>;
      inFlightRefreshes: Map<string, unknown>;
    };

    internal.accessCache.set('viewer-a:video-1', {});
    internal.inFlightRefreshes.set('owner:video-2', {});

    uid$.next('viewer-a');

    expect(internal.accessCache.size).toBe(1);
    expect(internal.inFlightRefreshes.size).toBe(1);
  });

  it('não reaproveita o namespace de cache entre A e B', () => {
    const uid$ = new BehaviorSubject<string | null>('viewer-a');
    TestBed.configureTestingModule({
      providers: [
        PublicVideoAccessService,
        { provide: Functions, useValue: {} },
        { provide: FirestoreContextService, useValue: {} },
        { provide: AuthSessionService, useValue: { uid$: uid$.asObservable() } },
        { provide: MediaApplicationErrorService, useValue: { reportSilently: vi.fn() } },
        { provide: PublicVideoOwnerEnrichmentService, useValue: {} },
      ],
    });
    const service = TestBed.inject(PublicVideoAccessService);
    const internal = service as unknown as {
      buildCacheKey(projection: IPublicVideoProjection): string;
    };
    const candidate = {
      id: 'video-1', ownerUid: 'owner-1', assetVersion: 42, publishedAt: 42,
    } as IPublicVideoProjection;

    const firstKey = internal.buildCacheKey(candidate);
    uid$.next('viewer-b');
    const secondKey = internal.buildCacheKey(candidate);

    expect(firstKey).toContain('session:uid:viewer-a');
    expect(secondKey).toContain('session:uid:viewer-b');
    expect(firstKey).not.toBe(secondKey);
  });

  it('descarta refresh atrasado de A e não compartilha in-flight com B', () => {
    const uid$ = new BehaviorSubject<string | null>('viewer-a');
    TestBed.configureTestingModule({
      providers: [
        PublicVideoAccessService,
        { provide: Functions, useValue: {} },
        { provide: FirestoreContextService, useValue: {} },
        { provide: AuthSessionService, useValue: { uid$: uid$.asObservable() } },
        { provide: MediaApplicationErrorService, useValue: { reportSilently: vi.fn() } },
        { provide: PublicVideoOwnerEnrichmentService, useValue: {} },
      ],
    });
    const service = TestBed.inject(PublicVideoAccessService);
    const internal = service as unknown as {
      accessCache: Map<string, IPublicVideoAccess>;
      requestAccessUrls$: (...args: unknown[]) => unknown;
    };
    const pendingA$ = new Subject<{ items: IPublicVideoAccess[] }>();
    const pendingB$ = new Subject<{ items: IPublicVideoAccess[] }>();
    const requestAccessUrls$ = vi.fn()
      .mockReturnValueOnce(pendingA$.asObservable())
      .mockReturnValueOnce(pendingB$.asObservable());
    internal.requestAccessUrls$ = requestAccessUrls$;

    const candidate = {
      id: 'video-1', ownerUid: 'owner-1', mediaType: 'VIDEO',
      visibility: 'PUBLIC', moderationStatus: 'APPROVED',
      mimeType: 'video/mp4', durationMs: 60_000, sizeBytes: 2_048,
      publishedAt: 100, assetAccess: 'SIGNED_URL', posterAccess: 'SIGNED_URL',
    } as IPublicVideoProjection;
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    service.refreshPublicVideoUrl$(candidate).subscribe((item) => receivedA.push(item));
    uid$.next('viewer-b');
    service.refreshPublicVideoUrl$(candidate).subscribe((item) => receivedB.push(item));

    expect(requestAccessUrls$).toHaveBeenCalledTimes(2);
    pendingA$.next({
      items: [{
        ownerUid: 'owner-1', videoId: 'video-1',
        url: 'https://example.test/old-session', posterUrl: null,
        expiresAt: Date.now() + 120_000,
      }],
    });
    pendingA$.complete();

    expect(receivedA).toEqual([null]);
    expect(internal.accessCache.size).toBe(0);

    pendingB$.next({
      items: [{
        ownerUid: 'owner-1', videoId: 'video-1',
        url: 'https://example.test/new-session', posterUrl: null,
        expiresAt: Date.now() + 120_000,
      }],
    });
    pendingB$.complete();

    expect(receivedB).toHaveLength(1);
    expect((receivedB[0] as { url: string }).url).toBe('https://example.test/new-session');
    expect(internal.accessCache.size).toBe(1);
    expect([...internal.accessCache.keys()][0]).toContain('session:uid:viewer-b');
  });

  it('descarta hidratação antiga após logout, inclusive antes de povoar cache', () => {
    const uid$ = new BehaviorSubject<string | null>('viewer-a');
    TestBed.configureTestingModule({
      providers: [
        PublicVideoAccessService,
        { provide: Functions, useValue: {} },
        { provide: FirestoreContextService, useValue: {} },
        { provide: AuthSessionService, useValue: { uid$: uid$.asObservable() } },
        { provide: MediaApplicationErrorService, useValue: { reportSilently: vi.fn() } },
        { provide: PublicVideoOwnerEnrichmentService, useValue: {} },
      ],
    });
    const service = TestBed.inject(PublicVideoAccessService);
    const pending$ = new Subject<{ items: IPublicVideoAccess[] }>();
    const internal = service as unknown as {
      accessCache: Map<string, IPublicVideoAccess>;
      hydrateAccess$: (items: IPublicVideoProjection[], mode: 'PLAYBACK') => import('rxjs').Observable<unknown[]>;
      requestAccessUrls$: (...args: unknown[]) => unknown;
    };
    internal.requestAccessUrls$ = vi.fn(() => pending$.asObservable());

    const candidate = {
      id: 'video-1', ownerUid: 'owner-1', mediaType: 'VIDEO',
      visibility: 'PUBLIC', moderationStatus: 'APPROVED',
      mimeType: 'video/mp4', durationMs: 60_000, sizeBytes: 2_048,
      publishedAt: 100, assetAccess: 'SIGNED_URL', posterAccess: 'SIGNED_URL',
    } as IPublicVideoProjection;
    const emitted: unknown[][] = [];
    internal.hydrateAccess$([candidate], 'PLAYBACK').subscribe((items) => emitted.push(items));
    uid$.next(null);
    pending$.next({
      items: [{
        ownerUid: 'owner-1', videoId: 'video-1',
        url: 'https://example.test/old-session', posterUrl: null,
        expiresAt: Date.now() + 120_000,
      }],
    });
    pending$.complete();

    expect(emitted).toEqual([[]]);
    expect(internal.accessCache.size).toBe(0);
  });

});
