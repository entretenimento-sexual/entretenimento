import { TestBed } from '@angular/core/testing';

import { GenderFilterService } from './gender-filter.service';

describe('GenderFilterService', () => {
  let service: GenderFilterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GenderFilterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
