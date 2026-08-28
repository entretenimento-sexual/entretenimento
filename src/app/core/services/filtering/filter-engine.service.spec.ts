import { TestBed } from '@angular/core/testing';

import { FilterEngineService } from './filter-engine.service';

describe('FilterEngineService', () => {
  let service: FilterEngineService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FilterEngineService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
