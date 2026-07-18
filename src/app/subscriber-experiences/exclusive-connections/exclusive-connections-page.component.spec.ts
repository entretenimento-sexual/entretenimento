import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ContentAccessDecision } from 'src/app/core/access/content-access-policy.model';
import { ContentAccessPolicyService } from 'src/app/core/access/content-access-policy.service';
import { ExclusiveConnectionsPageComponent } from './exclusive-connections-page.component';

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
  const accessPolicyMock = {
    evaluate$: vi.fn(),
  };

  const accessNavigationMock = {
    navigateForDecision: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      imports: [ExclusiveConnectionsPageComponent],
      providers: [
        { provide: ContentAccessPolicyService, useValue: accessPolicyMock },
        {
          provide: ContentAccessNavigationService,
          useValue: accessNavigationMock,
        },
      ],
    });
  });

  it('não instancia a prévia quando o acesso é negado', () => {
    accessPolicyMock.evaluate$.mockReturnValue(of(createDecision()));

    const fixture = TestBed.createComponent(ExclusiveConnectionsPageComponent);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        '.exclusive-connections-page__preview'
      )
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('app-content-access-notice')
    ).not.toBeNull();
  });

  it('renderiza somente a prévia segura quando o acesso é permitido', () => {
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
      fixture.nativeElement.querySelector(
        '.exclusive-connections-page__preview'
      )
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('app-content-access-notice')
    ).toBeNull();
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
