import { TestBed } from '@angular/core/testing';

import { CommunityModerationService } from './community-moderation.service';

describe('CommunityModerationService', () => {
  let service: CommunityModerationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CommunityModerationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
