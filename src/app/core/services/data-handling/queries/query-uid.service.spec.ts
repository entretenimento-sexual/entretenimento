//src\app\core\services\data-handling\queries\query-uid.service.spec.ts
import { TestBed } from '@angular/core/testing';

import { QueryUidService } from './query-uid.service';

describe('QueryUidService', () => {
  let service: QueryUidService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(QueryUidService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
