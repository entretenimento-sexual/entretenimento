import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { vi } from 'vitest';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';
import { CacheService } from './cache.service';
import { CacheSyncService } from './cache-sync.service';

describe('CacheSyncService', () => {
  let service: CacheSyncService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Firestore,
          useValue: {},
        },
        {
          provide: CacheService,
          useValue: {
            set: vi.fn(),
            delete: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            log: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(CacheSyncService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
