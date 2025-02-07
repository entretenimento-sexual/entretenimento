import { TestBed } from '@angular/core/testing';

import { CacheSyncService } from './cache-sync.service';

describe('CacheSyncService', () => {
  let service: CacheSyncService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CacheSyncService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
