import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { IPublicPhotoProjection } from 'src/app/core/interfaces/media/i-public-photo-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  PUBLIC_PHOTO_ACCESS_CACHE_MAX_ENTRIES,
  PublicPhotoAccessService,
} from './public-photo-access.service';
import { PublicPhotoOwnerEnrichmentService } from './public-photo-owner-enrichment.service';

interface TestAccessEntry {
  url: string;
  expiresAt: number;
}

interface PublicPhotoAccessInternals {
  accessCache: Map<string, TestAccessEntry>;
  buildCacheKey(projection: IPublicPhotoProjection): string;
  getCachedAccess(
    cacheKey: string,
    now: number
  ): TestAccessEntry | null;
  setCachedAccess(
    cacheKey: string,
    entry: TestAccessEntry
  ): void;
}

describe('PublicPhotoAccessService cache boundary', () => {
  function setup(initialUid: string | null = 'viewer-a') {
    const uid$ = new BehaviorSubject<string | null>(initialUid);

    TestBed.configureTestingModule({
      providers: [
        PublicPhotoAccessService,
        { provide: Functions, useValue: {} },
        {
          provide: PublicPhotoOwnerEnrichmentService,
          useValue: {
            enrich$: vi.fn((items: readonly IPublicPhotoProjection[]) =>
              of([...items])
            ),
          },
        },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$: vi.fn(),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$,
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
      ],
    });

    const service = TestBed.inject(PublicPhotoAccessService);

    return {
      service,
      uid$,
      internals: service as unknown as PublicPhotoAccessInternals,
    };
  }

  it('limita URLs temporárias por LRU e preserva a entrada recentemente usada', () => {
    const { internals } = setup();
    const now = 1_000;

    for (
      let index = 0;
      index < PUBLIC_PHOTO_ACCESS_CACHE_MAX_ENTRIES;
      index += 1
    ) {
      internals.setCachedAccess(`cache-${index}`, {
        url: `https://signed.example.test/${index}`,
        expiresAt: now + 120_000,
      });
    }

    expect(
      internals.getCachedAccess('cache-0', now)
    ).not.toBeNull();

    internals.setCachedAccess('cache-new', {
      url: 'https://signed.example.test/new',
      expiresAt: now + 120_000,
    });

    expect(internals.accessCache.size).toBe(
      PUBLIC_PHOTO_ACCESS_CACHE_MAX_ENTRIES
    );
    expect(internals.accessCache.has('cache-0')).toBe(true);
    expect(internals.accessCache.has('cache-1')).toBe(false);
    expect(internals.accessCache.has('cache-new')).toBe(true);
  });

  it('descarta URL expirada antes de reutilizá-la', () => {
    const { internals } = setup();
    const now = 10_000;

    internals.setCachedAccess('expired', {
      url: 'https://signed.example.test/expired',
      expiresAt: now + 20_000,
    });

    expect(
      internals.getCachedAccess('expired', now)
    ).toBeNull();
    expect(internals.accessCache.has('expired')).toBe(false);
  });

  it('limpa o cache e muda o namespace quando troca o UID da sessão', () => {
    const { uid$, internals } = setup('viewer-a');
    const candidate = projection();

    const firstKey = internals.buildCacheKey(candidate);
    internals.setCachedAccess(firstKey, {
      url: 'https://signed.example.test/photo-1',
      expiresAt: Date.now() + 120_000,
    });

    uid$.next('viewer-b');

    const secondKey = internals.buildCacheKey(candidate);

    expect(internals.accessCache.size).toBe(0);
    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).toContain('session:uid:viewer-a');
    expect(secondKey).toContain('session:uid:viewer-b');
  });
});

function projection(): IPublicPhotoProjection {
  return {
    id: 'photo-1',
    ownerUid: 'owner-1',
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    createdAt: 1,
    publishedAt: 1,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
  };
}
