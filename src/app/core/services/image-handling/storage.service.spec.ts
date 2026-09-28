import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';
import { Functions } from '@angular/fire/functions';

import { StorageService } from './storage.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { MediaApplicationErrorService } from '../media/media-application-error.service';
import { PrivacyDebugLoggerService } from '../privacy/privacy-debug-logger.service';
import {
  createStoreTestingMock,
  provideStoreTestingMock,
} from '../../../../test/ngrx-store-testing.providers';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    const storeMock = createStoreTestingMock();

    TestBed.configureTestingModule({
      providers: [
        ...provideStoreTestingMock(storeMock),
        {
          provide: Storage,
          useValue: {},
        },
        {
          provide: Auth,
          useValue: {
            currentUser: {
              uid: 'u1',
            },
          },
        },
        {
          provide: Functions,
          useValue: {},
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: () => undefined,
            showWarning: () => undefined,
            showSuccess: () => undefined,
            showInfo: () => undefined,
          },
        },
        {
          provide: MediaApplicationErrorService,
          useValue: {
            report: () => undefined,
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
    service = TestBed.inject(StorageService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
