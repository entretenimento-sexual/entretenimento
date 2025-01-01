import { TestBed } from '@angular/core/testing';

import { NearProfileFilterService } from './near-profile-filter.service';

describe('NearProfileFilterService', () => {
  let service: NearProfileFilterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NearProfileFilterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
