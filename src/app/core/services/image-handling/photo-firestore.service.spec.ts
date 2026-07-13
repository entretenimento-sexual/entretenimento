import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { of } from 'rxjs';

import { PhotoFirestoreService } from './photo-firestore.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

describe('PhotoFirestoreService', () => {
  let service: PhotoFirestoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Firestore,
          useValue: {},
        },
        {
          provide: Functions,
          useValue: {},
        },
        {
          provide: FirestoreContextService,
          useValue: {
            deferObservable$: (task: () => unknown) => task(),
            deferPromise$: (task: () => Promise<unknown>) => of(task()),
            run: (task: () => Promise<void>) => task(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: () => undefined,
            showSuccess: () => undefined,
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: () => undefined,
          },
        },
      ],
    });

    service = TestBed.inject(PhotoFirestoreService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
