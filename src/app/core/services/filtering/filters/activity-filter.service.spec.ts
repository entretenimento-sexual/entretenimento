import { TestBed } from '@angular/core/testing';

import { ActivityFilterService } from './activity-filter.service';

describe('ActivityFilterService', () => {
  let service: ActivityFilterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ActivityFilterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
