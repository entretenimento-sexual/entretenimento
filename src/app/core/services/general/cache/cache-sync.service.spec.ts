import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';

import { CacheSyncService } from './cache-sync.service';
import { CachePersistenceService } from './cache-persistence.service';
import { CacheService } from './cache.service';

describe('CacheSyncService', () => {
  let service: CacheSyncService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Firestore,
          useValue: {},
        },
        {
          provide: CacheService,
          useValue: {
            set: () => undefined,
          },
        },
        {
          provide: CachePersistenceService,
          useValue: {
            setPersistent: () => of(void 0),
          },
        },
      ],
    });
    service = TestBed.inject(CacheSyncService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
