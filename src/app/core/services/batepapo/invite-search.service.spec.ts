import { TestBed } from '@angular/core/testing';

import { InviteSearchService } from './invite-search.service';

describe('InviteSearchService', () => {
  let service: InviteSearchService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(InviteSearchService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
