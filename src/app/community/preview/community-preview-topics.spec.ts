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
import { CommunityTopicRepository } from '../data-access/community-topic.repository';
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
  const topicRepositoryMock = {
    getPage$: vi.fn(),
    getDetail$: vi.fn(),
    getRepliesPage$: vi.fn(),
    createTopic$: vi.fn(),
    createReply$: vi.fn(),
    moderateTopic$: vi.fn(),
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
    topicRepositoryMock.getPage$.mockReturnValue(
      of({
        items: [{
          topicId: 'topic-1',
          title: 'Convivência e segurança',
          excerpt: 'Discussão organizada para consulta posterior.',
          author: { label: 'Pessoa', avatarUrl: null },
          status: 'active',
          metrics: { replyCount: 2, reactionCount: 0 },
          createdAt: now - 10_000,
          lastActivityAt: now - 1_000,
        }],
        nextCursor: null,
        generatedAt: now,
      })
    );
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
        { provide: CommunityTopicRepository, useValue: topicRepositoryMock },
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

  it('expõe Discussões como seção canônica complementar ao Mural', () => {
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const tabs = fixture.nativeElement.querySelectorAll(
      '.community-preview__tabs button'
    ) as NodeListOf<HTMLButtonElement>;

    expect(fixture.componentInstance.activeSection()).toBe('topics');
    expect(tabs).toHaveLength(5);
    expect(fixture.nativeElement.textContent).toContain('Membros');
    expect(fixture.nativeElement.textContent).toContain('Mural');
    expect(fixture.nativeElement.textContent).toContain('Discussões');
    expect(fixture.nativeElement.textContent).toContain('Fotos');
    expect(fixture.nativeElement.textContent).toContain('Sobre');
    expect(fixture.nativeElement.querySelector('#community-tab-topics')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-community-topics')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Convivência e segurança');
    expect(topicRepositoryMock.getPage$).toHaveBeenCalledWith({
      communityId: 'community-1',
      limit: 12,
      cursor: null,
    });
    expect(feedRepositoryMock.getPage$).not.toHaveBeenCalled();
  });
});
