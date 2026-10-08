import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import type { CommunityDiscoveryPage } from '../data-access/community-preview.model';
import { CommunityDiscoveryCacheService } from './community-discovery-cache.service';
import { CommunityDiscoveryDataFacade, type CommunityDiscoveryDataConfig } from './community-discovery-data.facade';

describe('CommunityDiscoveryDataFacade - troca de conta', () => {
  it('cancela consulta e cards de A sem gravá-los no cache de B', () => {
    const uid$ = new BehaviorSubject<string | null>('viewer-a');
    const pageA$ = new Subject<CommunityDiscoveryPage>();
    const pageB$ = new Subject<CommunityDiscoveryPage>();
    const rememberPage = vi.fn();
    const getDiscoveryPage$ = vi.fn()
      .mockReturnValueOnce(pageA$.asObservable())
      .mockReturnValueOnce(pageB$.asObservable());

    TestBed.configureTestingModule({
      providers: [
        CommunityDiscoveryDataFacade,
        { provide: AuthSessionService, useValue: { uid$: uid$.asObservable() } },
        { provide: CommunityPreviewRepository, useValue: { getDiscoveryPage$ } },
        {
          provide: CommunityDiscoveryCacheService,
          useValue: { readSnapshot$: vi.fn(() => of(null)), rememberPage },
        },
        { provide: ApplicationErrorService, useValue: { normalize: vi.fn(), report: vi.fn() } },
      ],
    });
    const facade = TestBed.inject(CommunityDiscoveryDataFacade);
    const config: CommunityDiscoveryDataConfig = {
      sourceType: 'venue',
      discoveryMode: 'explore',
      canFilterByTags: false,
      title: 'Locais',
      initialTagId: null,
    };
    const states: Array<{ status: string; items: readonly unknown[] }> = [];
    const sub = facade.connect(config).subscribe((state) => states.push(state));

    expect(getDiscoveryPage$).toHaveBeenCalledTimes(1);
    uid$.next('viewer-b');
    expect(getDiscoveryPage$).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ status: 'loading', items: [] });

    pageA$.next({ items: [{ communityId: 'old-a' } as never], nextCursor: null, generatedAt: 1 });
    pageA$.complete();
    expect(rememberPage).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({ status: 'loading', items: [] });

    pageB$.next({ items: [{ communityId: 'new-b' } as never], nextCursor: null, generatedAt: 2 });
    pageB$.complete();
    expect(rememberPage).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.items.map((item) => (item as { communityId: string }).communityId)).toEqual(['new-b']);
    sub.unsubscribe();
  });
});
