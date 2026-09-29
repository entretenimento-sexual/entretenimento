import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { BehaviorSubject } from 'rxjs';
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
});
