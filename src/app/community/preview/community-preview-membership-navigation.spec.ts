import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityPreviewResponse } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityPreviewPageComponent } from './community-preview-page.component';

function preview(): CommunityPreviewResponse {
  return {
    community: {
      communityId: 'community-1',
      name: 'Local do Centro',
      slug: 'local-do-centro',
      description: 'Atualizações e fotos do Local.',
      source: { type: 'venue', id: 'venue-1' },
      avatarUrl: null,
      coverUrl: null,
      metrics: { memberCount: 12, postCount: 4, mediaCount: 3 },
      access: {
        join: 'approval',
        minimumRole: null,
        requiresActiveSubscription: false,
      },
      tags: [],
    },
    rules: null,
    lifecycleStatus: null,
    viewerMode: 'visitor',
    viewerRole: null,
    canInteract: false,
    canManageMemberships: false,
    canInviteCommunityMembers: false,
    canManageCommunitySettings: false,
    capacity: null,
    settings: null,
    canLeaveMembership: false,
    generatedAt: 123,
  };
}

describe('CommunityPreviewPageComponent membership access navigation', () => {
  const previewRepositoryMock = { getPreview$: vi.fn() };
  const feedRepositoryMock = {
    getPage$: vi.fn(),
    getItems$: vi.fn(),
    watchLatestChanges$: vi.fn(),
  };
  const membershipRepositoryMock = {
    requestMembership$: vi.fn(),
    leaveMembership$: vi.fn(),
    getMembershipRequests$: vi.fn(),
    reviewMembership$: vi.fn(),
  };
  const accessNavigationMock = { navigateForDecision: vi.fn() };
  const errorNotifierMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
    showInfo: vi.fn(),
  };
  const globalErrorMock = { handleError: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    previewRepositoryMock.getPreview$.mockReturnValue(of(preview()));
    feedRepositoryMock.getPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 123 })
    );
    feedRepositoryMock.getItems$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 123 })
    );
    feedRepositoryMock.watchLatestChanges$.mockReturnValue(of([]));
    membershipRepositoryMock.leaveMembership$.mockReturnValue(
      of({ status: 'left', viewerMode: 'visitor', canInteract: false })
    );
    membershipRepositoryMock.getMembershipRequests$.mockReturnValue(
      of({ items: [], generatedAt: 123 })
    );
    membershipRepositoryMock.reviewMembership$.mockReturnValue(
      of({ memberId: 'member-1', status: 'active', viewerMode: 'member' })
    );

    TestBed.configureTestingModule({
      imports: [CommunityPreviewPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { backRoute: '/dashboard/locais' },
              queryParamMap: convertToParamMap({}),
            },
            paramMap: of(convertToParamMap({ communityId: 'community-1' })),
          },
        },
        {
          provide: MatDialog,
          useValue: { open: vi.fn(() => ({ afterClosed: () => of(false) })) },
        },
        { provide: CommunityPreviewRepository, useValue: previewRepositoryMock },
        { provide: CommunityFeedRepository, useValue: feedRepositoryMock },
        { provide: CommunityMembershipRepository, useValue: membershipRepositoryMock },
        { provide: ContentAccessNavigationService, useValue: accessNavigationMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  it('não encerra o fluxo reativo quando a navegação exigida falha', async () => {
    membershipRepositoryMock.requestMembership$.mockReturnValueOnce(
      throwError(() => ({
        code: 'functions/failed-precondition',
        details: {
          reason: 'profile_incomplete',
          recommendedAction: 'complete_profile',
        },
      }))
    );
    accessNavigationMock.navigateForDecision.mockRejectedValueOnce(
      new Error('navigation failed')
    );

    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.requestMembership(preview().community);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(accessNavigationMock.navigateForDecision).toHaveBeenCalledTimes(1);
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível abrir a etapa necessária para continuar.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalled();

    membershipRepositoryMock.requestMembership$.mockReturnValue(
      of({ status: 'pending', viewerMode: 'pending', canInteract: false })
    );

    component.requestMembership(preview().community);
    await Promise.resolve();
    fixture.detectChanges();

    expect(membershipRepositoryMock.requestMembership$).toHaveBeenCalledTimes(2);
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Solicitação de acesso enviada.'
    );
  });
});
