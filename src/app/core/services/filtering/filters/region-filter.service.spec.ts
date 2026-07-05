import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';

import { RegionFilterService } from './region-filter.service';
import { FirestoreContextService } from '../../data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { IBGELocationService } from '../../general/api/ibge-location.service';

describe('RegionFilterService', () => {
  let service: RegionFilterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Firestore,
          useValue: {},
        },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$: () => of(null),
          },
        },
        {
          provide: IBGELocationService,
          useValue: {
            getMunicipios: () => of([]),
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
          },
        },
      ],
    });
    service = TestBed.inject(RegionFilterService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
