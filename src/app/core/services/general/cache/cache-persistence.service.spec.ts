import { TestBed } from '@angular/core/testing';

import { CachePersistenceService } from './cache-persistence.service';

describe('CachePersistenceService', () => {
  let service: CachePersistenceService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CachePersistenceService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
