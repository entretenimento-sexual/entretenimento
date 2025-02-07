import { TestBed } from '@angular/core/testing';

import { CacheStateService } from './cache-state.service';

describe('CacheStateService', () => {
  let service: CacheStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CacheStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
