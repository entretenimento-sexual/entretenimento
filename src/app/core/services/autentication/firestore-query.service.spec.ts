import { TestBed } from '@angular/core/testing';

import { FirestoreQueryService } from './firestore-query.service';

describe('FirestoreQueryService', () => {
  let service: FirestoreQueryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FirestoreQueryService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
