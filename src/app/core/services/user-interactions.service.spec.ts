import { TestBed } from '@angular/core/testing';

import { UserInteractionsService } from './user-interactions.service';

describe('UserInteractionsService', () => {
  let service: UserInteractionsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UserInteractionsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
