import { TestBed } from '@angular/core/testing';

import { FileScanService } from './file-scan.service';

describe('FileScanService', () => {
  let service: FileScanService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FileScanService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
