import { TestBed } from '@angular/core/testing';

import { PhotoFirestoreService } from './photo-firestore.service';

describe('PhotoFirestoreService', () => {
  let service: PhotoFirestoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PhotoFirestoreService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
