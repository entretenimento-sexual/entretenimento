import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';

import { SubscriptionService } from './subscription.service';
import { PlatformSubscriptionAccessService } from './platform-subscription-access.service';

describe('SubscriptionService', () => {
  let service: SubscriptionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PlatformSubscriptionAccessService,
          useValue: {
            state$: of({
              active: true,
              role: 'vip',
              startsAt: 1_799_000_000_000,
              endsAt: 1_801_000_000_000,
              projectionVersion: 1,
              reason: null,
            }),
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
          useValue: { navigate: vi.fn() },
        },
      ],
    });
    service = TestBed.inject(SubscriptionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('preserva o método legado usando a hierarquia canônica', async () => {
    const premium = await firstValueFrom(
      service.checkUserSubscription('premium')
    );
    const free = await firstValueFrom(service.checkUserSubscription('free'));

    expect(premium.isSubscriber).toBe(true);
    expect(premium.monthlyPayer).toBe(true);
    expect(premium.subscriptionExpires?.getTime()).toBe(1_801_000_000_000);
    expect(free.isSubscriber).toBe(false);
  });
});
