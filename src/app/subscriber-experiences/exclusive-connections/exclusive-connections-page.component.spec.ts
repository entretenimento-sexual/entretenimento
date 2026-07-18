import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ContentAccessDecision } from 'src/app/core/access/content-access-policy.model';
import { ContentAccessPolicyService } from 'src/app/core/access/content-access-policy.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ExclusiveConnectionsPageComponent } from './exclusive-connections-page.component';
import { ExclusiveConnectionsRepository } from './exclusive-connections.repository';

function createDecision(
  overrides: Partial<ContentAccessDecision> = {}
): ContentAccessDecision {
  return {
    allowed: false,
    reason: 'subscription_inactive',
    recommendedAction: 'upgrade_subscription',
    minimumRole: 'premium',
    missingProfileFields: [],
    ...overrides,
  };
}

describe('ExclusiveConnectionsPageComponent', () => {
  const accessPolicyMock = { evaluate$: vi.fn() };
  const accessNavigationMock = { navigateForDecision: vi.fn() };
  const repositoryMock = { getPage$: vi.fn() };
  const errorNotifierMock = { showError: vi.fn() };
  const globalErrorMock = { handleError: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 123 })
    );

    TestBed.configureTestingModule({
      imports: [ExclusiveConnectionsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ContentAccessPolicyService, useValue: accessPolicyMock },
        { provide: ContentAccessNavigationService, useValue: accessNavigationMock },
        { provide: ExclusiveConnectionsRepository, useValue: repositoryMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  it('não instancia o feed nem consulta dados quando o acesso é negado', () => {
    accessPolicyMock.evaluate$.mockReturnValue(of(createDecision()));

    const fixture = TestBed.createComponent(ExclusiveConnectionsPageComponent);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('app-exclusive-connections-feed')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('app-content-access-notice')
    ).not.toBeNull();
    expect(repositoryMock.getPage$).not.toHaveBeenCalled();
  });

  it('instancia o feed somente quando o acesso é permitido', () => {
    accessPolicyMock.evaluate$.mockReturnValue(
      of(
        createDecision({
          allowed: true,
          reason: null,
          recommendedAction: null,
        })
      )
    );

    const fixture = TestBed.createComponent(ExclusiveConnectionsPageComponent);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('app-exclusive-connections-feed')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('app-content-access-notice')
    ).toBeNull();
    expect(repositoryMock.getPage$).toHaveBeenCalledTimes(1);
  });

  it('avalia a política específica da experiência', () => {
    accessPolicyMock.evaluate$.mockReturnValue(of(createDecision()));

    TestBed.createComponent(ExclusiveConnectionsPageComponent);

    expect(accessPolicyMock.evaluate$).toHaveBeenCalledTimes(1);
    expect(accessPolicyMock.evaluate$).toHaveBeenCalledWith(
      expect.objectContaining({
        minimumRole: 'premium',
        requiresActiveSubscription: true,
        requiresCompletedProfile: true,
        requiresAdultAccess: true,
      })
    );
  });
});
