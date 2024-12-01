import { TestBed } from '@angular/core/testing';

import { FirestoreUserQueryService } from './firestore-user-query.service';

describe('FirestoreUserQueryService', () => {
  let service: FirestoreUserQueryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FirestoreUserQueryService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
