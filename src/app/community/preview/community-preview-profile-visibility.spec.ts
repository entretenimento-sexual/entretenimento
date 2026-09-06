import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityInviteRepository } from '../data-access/community-invite.repository';
import { CommunityMembershipProfileVisibilityRepository } from '../data-access/community-membership-profile-visibility.repository';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import type { CommunityPreviewResponse } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityPreviewPageComponent } from './community-preview-page.component';

function buildMemberPreview(): CommunityPreviewResponse {
  return {
    community: {
      communityId: 'community-privacy-1',
      name: 'Comunidade Privada por Padrão',
      slug: 'comunidade-privada-por-padrao',
      description: 'Comunidade usada para validar o opt-in no próprio espaço.',
      source: { type: 'community', id: 'community-privacy-1' },
      avatarUrl: null,
      coverUrl: null,
      tags: [],
      metrics: { memberCount: 7, postCount: 2, mediaCount: 1 },
      access: {
        join: 'open',
        minimumRole: null,
        requiresActiveSubscription: false,
      },
    },
    rules: null,
    lifecycleStatus: 'active',
    viewerMode: 'member',
    viewerRole: 'member',
    canInteract: true,
    canManageMemberships: false,
    canInviteCommunityMembers: false,
    canManageCommunitySettings: false,
    capacity: {
      configuredLimit: 25,
      effectiveLimit: 25,
      memberCount: 7,
      acceptingNewMembers: true,
      restrictedByOwnerPlan: false,
      memberLimitOptions: [],
      allowedMemberLimits: [],
    },
    settings: null,
    canLeaveMembership: true,
    generatedAt: 123,
  };
}

describe('CommunityPreviewPageComponent / opt-in público', () => {
  const previewRepositoryMock = {
    getPreview$: vi.fn(() => of(buildMemberPreview())),
  };
  const visibilityRepositoryMock = {
    getState$: vi.fn(),
    updateVisibility$: vi.fn(),
    updateDisclosure$: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    visibilityRepositoryMock.getState$.mockReturnValue(of({
      communityId: 'community-privacy-1',
      disclosureMode: 'opt_in',
      policyVersion: 2,
      profileVisibility: 'hidden',
      profileVisibilityPolicyVersion: null,
      canChange: true,
      canManagePolicy: false,
      generatedAt: 123,
    }));

    TestBed.configureTestingModule({
      imports: [CommunityPreviewPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { backRoute: '/dashboard/comunidades' },
              queryParamMap: convertToParamMap({}),
            },
            paramMap: of(convertToParamMap({ communityId: 'community-privacy-1' })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
        { provide: CommunityPreviewRepository, useValue: previewRepositoryMock },
        {
          provide: CommunityFeedRepository,
          useValue: {
            getPage$: vi.fn(() => of({ items: [], nextCursor: null, generatedAt: 123 })),
            getItems$: vi.fn(() => of({ items: [], nextCursor: null, generatedAt: 123 })),
            watchLatestChanges$: vi.fn(() => of([])),
          },
        },
        {
          provide: CommunityMembershipRepository,
          useValue: {
            requestMembership$: vi.fn(),
            leaveMembership$: vi.fn(),
            getMembershipRequests$: vi.fn(),
            reviewMembership$: vi.fn(),
          },
        },
        {
          provide: CommunityInviteRepository,
          useValue: {
            getSentInvites$: vi.fn(() => of({ items: [], generatedAt: 123 })),
            findCandidate$: vi.fn(),
            sendInvite$: vi.fn(),
            revokeInvite$: vi.fn(),
          },
        },
        {
          provide: CommunityMembershipProfileVisibilityRepository,
          useValue: visibilityRepositoryMock,
        },
        { provide: PhotoEditorLauncherService, useValue: { editFile$: vi.fn(() => of(null)) } },
        { provide: ContentAccessNavigationService, useValue: { navigateForDecision: vi.fn() } },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    });
  });

  it('mantém o acesso à privacidade visível na própria Comunidade e abre o controle sem rota separada', () => {
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const privacyButton = Array.from(
      fixture.nativeElement.querySelectorAll('button')
    ).find((button: Element) => button.textContent?.includes('Privacidade')) as HTMLButtonElement | undefined;

    expect(privacyButton).toBeTruthy();
    privacyButton?.click();
    fixture.detectChanges();
    fixture.detectChanges();

    const control = fixture.nativeElement.querySelector(
      'app-community-membership-profile-visibility'
    ) as HTMLElement | null;

    expect(control).not.toBeNull();
    expect(control?.textContent).toContain('Sua participação continua privada por padrão');
    expect(control?.textContent).toContain('Oculta');
    expect(control?.textContent).toContain('Visível no meu perfil');
    expect(control?.textContent).not.toContain('Permitir opt-in dos membros');
    expect(visibilityRepositoryMock.getState$).toHaveBeenCalledWith('community-privacy-1');
  });

  it('exibe política comunitária somente quando o backend retorna canManagePolicy', () => {
    visibilityRepositoryMock.getState$.mockReturnValue(of({
      communityId: 'community-privacy-1',
      disclosureMode: 'opt_in',
      policyVersion: 2,
      profileVisibility: 'hidden',
      profileVisibilityPolicyVersion: null,
      canChange: true,
      canManagePolicy: true,
      generatedAt: 123,
    }));

    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectSection('about', true);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Permitir opt-in dos membros');
  });
});
