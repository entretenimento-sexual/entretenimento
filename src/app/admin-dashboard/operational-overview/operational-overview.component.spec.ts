import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { filter } from 'rxjs/operators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OperationalOverviewComponent } from './operational-overview.component';
import { AdminUserOverviewService } from '../../core/services/account-moderation/admin-user-overview.service';
import { AdminModerationReportService } from '../../core/services/moderation/admin-moderation-report.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from '../../core/services/error-handler/application-error.service';

const counts = {
  totalUsers: 8,
  completedProfiles: 3,
  incompleteProfiles: 5,
  restrictedUsers: 2,
  onlineUsers: 3,
  subscribers: 2,
};

function setup(response: import("rxjs").Observable<import("../../core/services/account-moderation/admin-user-overview.model").AdminUserOverview>) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminUserOverviewService,
        useValue: {
          getAdminUserOverview$: vi.fn(() => response),
        },
      },
      {
        provide: AdminModerationReportService,
        useValue: {
          listReports$: vi.fn(() => of([])),
        },
      },
      {
        provide: ErrorNotificationService,
        useValue: {
          showError: vi.fn(),
          showSuccess: vi.fn(),
          showWarning: vi.fn(),
        },
      },
      {
        provide: ApplicationErrorService,
        useValue: {
          report: vi.fn(),
        },
      },
    ],
  });

  return TestBed.runInInjectionContext(
    () => new OperationalOverviewComponent()
  );
}

describe('Administrative overview aggregates', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('uses aggregated counts', async () => {
    const component = setup(of(counts));

    const vm = await firstValueFrom(
      component.vm$.pipe(filter(value => !value.loading))
    );

    expect(vm.totalUsers).toBe(8);
    expect(vm.metrics.find(
      metric => metric.icon === 'groups'
    )?.value).toBe(8);

    expect(vm.metrics.find(
      metric => metric.icon === 'assignment_late'
    )?.value).toBe(5);

    expect(vm.quickActions.find(
      action => action.icon === 'shield'
    )?.count).toBe(2);
  });

  it('does not replace missing counts with zero', async () => {
    const component = setup(
      throwError(() => new Error('permission-denied'))
    );

    const vm = await firstValueFrom(
      component.vm$.pipe(filter(value => !value.loading))
    );

    expect(vm.failed).toBe(true);
    expect(vm.totalUsers).toBeNull();

    expect(vm.metrics.find(
      metric => metric.icon === 'groups'
    )?.value).toBeNull();

    expect(vm.quickActions.find(
      action => action.icon === 'person_search'
    )?.count).toBeNull();

    expect(vm.alerts.some(
      alert => alert.icon === 'verified'
    )).toBe(false);
  });
});
