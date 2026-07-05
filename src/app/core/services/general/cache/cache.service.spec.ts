import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { CacheService } from './cache.service';
import { CachePersistenceService } from './cache-persistence.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import {
  createStoreTestingMock,
  provideStoreTestingMock,
} from '../../../../../test/ngrx-store-testing.providers';

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(() => {
    const storeMock = createStoreTestingMock();

    TestBed.configureTestingModule({
      providers: [
        ...provideStoreTestingMock(storeMock),
        {
          provide: CachePersistenceService,
          useValue: {
            getPersistent: () => of(null),
            setPersistent: () => of(void 0),
            removePersistent: () => of(void 0),
            clear: () => of(void 0),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: () => undefined,
          },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            log: () => undefined,
          },
        },
      ],
    });
    service = TestBed.inject(CacheService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
