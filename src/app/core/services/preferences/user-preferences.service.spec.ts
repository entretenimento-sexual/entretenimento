import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';

import { UserPreferencesService } from './user-preferences.service';
import { CacheService } from '../general/cache/cache.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import {
  createStoreTestingMock,
  provideStoreTestingMock,
} from '../../../../test/ngrx-store-testing.providers';

describe('UserPreferencesService', () => {
  let service: UserPreferencesService;

  beforeEach(() => {
    const storeMock = createStoreTestingMock();

    TestBed.configureTestingModule({
      providers: [
        ...provideStoreTestingMock(storeMock),
        {
          provide: Firestore,
          useValue: {},
        },
        {
          provide: CacheService,
          useValue: {
            get: () => of(null),
            set: () => undefined,
          },
        },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$: () => of({ docs: [] }),
            run: async (task: () => Promise<void>) => task(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: () => undefined,
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: () => undefined,
            showSuccess: () => undefined,
            showWarning: () => undefined,
            showInfo: () => undefined,
          },
        },
      ],
    });
    service = TestBed.inject(UserPreferencesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
