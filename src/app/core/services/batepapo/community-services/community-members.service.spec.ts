import { TestBed } from '@angular/core/testing';

import { CommunityMembersService } from './community-members.service';

describe('CommunityMembersService', () => {
  let service: CommunityMembersService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CommunityMembersService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
