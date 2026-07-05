import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { SubscriptionService } from './subscription.service';
import { CurrentUserStoreService } from '../autentication/auth/current-user-store.service';
import { DateTimeService } from '../general/date-time.service';

describe('SubscriptionService', () => {
  let service: SubscriptionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of(null),
          },
        },
        {
          provide: DateTimeService,
          useValue: {
            convertToDate: (value: unknown) => new Date(value as string | number | Date),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(() => ({ afterClosed: () => of(false) })),
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(SubscriptionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
