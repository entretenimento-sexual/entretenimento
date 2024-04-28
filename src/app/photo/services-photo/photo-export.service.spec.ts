import { TestBed } from '@angular/core/testing';

import { PhotoExportService } from './photo-export.service';

describe('PhotoExportService', () => {
  let service: PhotoExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PhotoExportService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
