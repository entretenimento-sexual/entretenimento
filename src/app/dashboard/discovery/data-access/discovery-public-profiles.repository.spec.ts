import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { vi } from 'vitest';

import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { PublicProfileReadBoundaryService } from 'src/app/core/services/discovery/public-profile-read-boundary.service';
import { DiscoveryPublicProfilesRepository } from './discovery-public-profiles.repository';

describe('DiscoveryPublicProfilesRepository / sessão e SWR', () => {
  const request = { viewerUid: 'user-a', mode: 'all' as const, pageSize: 24 };

  it('não consulta cache nem servidor para UID diferente da sessão', () => {
    const uid = new BehaviorSubject<string | null>('user-b');
    const cache = { get: vi.fn(() => of(null)), set: vi.fn() };
    const backend = { read$: vi.fn(() => of({ items: [], nextCursor: null, reachedEnd: true, fetchedAt: 1 })) };
    TestBed.configureTestingModule({ providers: [
      DiscoveryPublicProfilesRepository,
      { provide: AccessControlService, useValue: { authUid$: uid.asObservable() } },
      { provide: CacheService, useValue: cache },
      { provide: PublicProfileReadBoundaryService, useValue: backend },
    ] });
    const output: unknown[] = [];
    TestBed.inject(DiscoveryPublicProfilesRepository).loadPage$(request).subscribe(x => output.push(x));
    expect(output).toEqual([]);
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(backend.read$).not.toHaveBeenCalled();
  });

  it('descarta resposta tardia do backend e não ressuscita cache após troca de UID', () => {
    const uid = new BehaviorSubject<string | null>('user-a');
    const pending = new Subject<{ items: never[]; nextCursor: null; reachedEnd: boolean; fetchedAt: number }>();
    const cache = { get: vi.fn(() => of(null)), set: vi.fn() };
    const backend = { read$: vi.fn(() => pending.asObservable()) };
    TestBed.configureTestingModule({ providers: [
      DiscoveryPublicProfilesRepository,
      { provide: AccessControlService, useValue: { authUid$: uid.asObservable() } },
      { provide: CacheService, useValue: cache },
      { provide: PublicProfileReadBoundaryService, useValue: backend },
    ] });
    const output: unknown[] = [];
    const sub = TestBed.inject(DiscoveryPublicProfilesRepository).loadPage$(request).subscribe(x => output.push(x));
    expect(backend.read$).toHaveBeenCalledTimes(1);
    uid.next('user-b');
    pending.next({ items: [], nextCursor: null, reachedEnd: true, fetchedAt: 1 });
    expect(output).toEqual([]);
    expect(cache.set).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
});
