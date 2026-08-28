import { TestBed } from '@angular/core/testing';

import { PreferencesFilterService } from './preferences-filter.service';

describe('PreferencesFilterService', () => {
  let service: PreferencesFilterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PreferencesFilterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
