import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ContentAccessDecision } from 'src/app/core/access/content-access-policy.model';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ExclusiveConnectionsAccessService } from './exclusive-connections-access.service';
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
  const accessMock = {
    evaluate$: vi.fn(),
    refresh: vi.fn(),
  };
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
        { provide: ExclusiveConnectionsAccessService, useValue: accessMock },
        { provide: ContentAccessNavigationService, useValue: accessNavigationMock },
        { provide: ExclusiveConnectionsRepository, useValue: repositoryMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  it('não instancia o feed nem consulta dados quando o acesso é negado', () => {
    accessMock.evaluate$.mockReturnValue(of(createDecision()));

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

  it('instancia o feed somente quando perfil e entitlement são permitidos', () => {
    accessMock.evaluate$.mockReturnValue(
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

  it('consulta o serviço autoritativo de acesso uma única vez por instância', () => {
    accessMock.evaluate$.mockReturnValue(of(createDecision()));

    TestBed.createComponent(ExclusiveConnectionsPageComponent);

    expect(accessMock.evaluate$).toHaveBeenCalledTimes(1);
  });

  it('encaminha a ação de nova tentativa ao serviço de acesso', () => {
    accessMock.evaluate$.mockReturnValue(
      of(
        createDecision({
          reason: 'access_check_unavailable',
          recommendedAction: null,
        })
      )
    );

    const fixture = TestBed.createComponent(ExclusiveConnectionsPageComponent);
    fixture.detectChanges();

    const retryButton = fixture.nativeElement.querySelector(
      'app-content-access-notice button'
    ) as HTMLButtonElement;
    retryButton.click();

    expect(accessMock.refresh).toHaveBeenCalledTimes(1);
    expect(accessNavigationMock.navigateForDecision).not.toHaveBeenCalled();
  });
});
