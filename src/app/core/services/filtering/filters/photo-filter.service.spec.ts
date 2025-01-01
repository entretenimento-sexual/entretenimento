import { TestBed } from '@angular/core/testing';

import { PhotoFilterService } from './photo-filter.service';

describe('PhotoFilterService', () => {
  let service: PhotoFilterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PhotoFilterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
