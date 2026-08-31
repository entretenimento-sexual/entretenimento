import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityHighlightUiService } from '../highlight/community-highlight-ui.service';
import { CommunityPreviewPageComponent } from './community-preview-page.component';

const now = Date.now();

function communityPreview() {
  return {
    community: {
      communityId: 'community-1',
      name: 'Comunidade de Conversa',
      slug: 'comunidade-de-conversa',
      description: 'Uma comunidade persistente.',
      source: { type: 'community' as const, id: 'community-1' },
      avatarUrl: null,
      coverUrl: null,
      tags: [],
      metrics: { memberCount: 10, postCount: 3, mediaCount: 2 },
      access: {
        join: 'open' as const,
        minimumRole: null,
        requiresActiveSubscription: false,
      },
    },
    viewerMode: 'visitor' as const,
    viewerRole: null,
    canInteract: false,
    generatedAt: now,
  };
}

describe('CommunityPreviewPageComponent / seções principais', () => {
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
  const highlightUiMock = {
    state$: vi.fn(),
    refresh: vi.fn(),
    manage$: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    previewRepositoryMock.getPreview$.mockReturnValue(of(communityPreview()));
    feedRepositoryMock.getPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: now })
    );
    feedRepositoryMock.getItems$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: now })
    );
    feedRepositoryMock.watchLatestChanges$.mockReturnValue(of([]));
    highlightUiMock.state$.mockReturnValue(of({
      status: 'ready',
      communityId: 'community-1',
      highlight: null,
      item: null,
      canManage: false,
    }));

    const legacyTopicsParams = convertToParamMap({ secao: 'topicos' });

    TestBed.configureTestingModule({
      imports: [CommunityPreviewPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { backRoute: '/dashboard/comunidades' },
              queryParamMap: legacyTopicsParams,
            },
            paramMap: of(convertToParamMap({ communityId: 'community-1' })),
            queryParamMap: of(legacyTopicsParams),
          },
        },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: CommunityPreviewRepository, useValue: previewRepositoryMock },
        { provide: CommunityFeedRepository, useValue: feedRepositoryMock },
        { provide: CommunityHighlightUiService, useValue: highlightUiMock },
        { provide: CommunityMembershipRepository, useValue: membershipRepositoryMock },
        { provide: StorageService, useValue: { uploadFile: vi.fn() } },
        {
          provide: AuthSessionService,
          useValue: { currentAuthUser: { uid: 'u1' } },
        },
        {
          provide: ContentAccessNavigationService,
          useValue: { navigateForDecision: vi.fn(async () => true) },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
            showInfo: vi.fn(),
          },
        },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });
  });

  it('mantém Mural, Fotos e Sobre e converte link legado de tópicos para Mural', () => {
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const tabs = fixture.nativeElement.querySelectorAll(
      '.community-preview__tabs button'
    ) as NodeListOf<HTMLButtonElement>;

    expect(fixture.componentInstance.activeSection()).toBe('feed');
    expect(tabs).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('Mural');
    expect(fixture.nativeElement.textContent).toContain('Fotos');
    expect(fixture.nativeElement.textContent).toContain('Sobre');
    expect(fixture.nativeElement.textContent).not.toContain('Discussões');
    expect(fixture.nativeElement.querySelector('#community-tab-topics')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-community-topics')).toBeNull();
    expect(feedRepositoryMock.getPage$).toHaveBeenCalledWith(
      expect.objectContaining({ communityId: 'community-1', view: 'feed' })
    );
  });
});
