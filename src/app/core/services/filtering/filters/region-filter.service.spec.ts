import { TestBed } from '@angular/core/testing';

import { RegionFilterService } from './region-filter.service';

describe('RegionFilterService', () => {
  let service: RegionFilterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RegionFilterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
