import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityTopicRepository } from '../data-access/community-topic.repository';
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

describe('CommunityPreviewPageComponent / Tópicos', () => {
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
  };
  const membershipRepositoryMock = {
    requestMembership$: vi.fn(),
    leaveMembership$: vi.fn(),
    getMembershipRequests$: vi.fn(),
    reviewMembership$: vi.fn(),
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
        items: [
          {
            topicId: 'topic-1',
            title: 'Primeiro Tópico',
            excerpt: 'Discussão persistente.',
            author: { label: 'Pessoa', avatarUrl: null },
            status: 'active',
            metrics: { replyCount: 0, reactionCount: 0 },
            createdAt: now - 1_000,
            lastActivityAt: now - 500,
          },
        ],
        nextCursor: null,
        generatedAt: now,
      })
    );

    TestBed.configureTestingModule({
      imports: [CommunityPreviewPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { backRoute: '/dashboard/comunidades' } },
            paramMap: of(convertToParamMap({ communityId: 'community-1' })),
          },
        },
        { provide: CommunityPreviewRepository, useValue: previewRepositoryMock },
        { provide: CommunityFeedRepository, useValue: feedRepositoryMock },
        { provide: CommunityTopicRepository, useValue: topicRepositoryMock },
        { provide: CommunityMembershipRepository, useValue: membershipRepositoryMock },
        {
          provide: ContentAccessNavigationService,
          useValue: { navigateForDecision: vi.fn(async () => true) },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });
  });

  it('oferece Discussões somente no preview de Comunidade e carrega sob demanda', () => {
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const tabs = fixture.nativeElement.querySelectorAll(
      '.community-preview__tabs button'
    ) as NodeListOf<HTMLButtonElement>;

    expect(tabs).toHaveLength(4);
    expect(fixture.nativeElement.textContent).toContain('Discussões');
    expect(topicRepositoryMock.getPage$).not.toHaveBeenCalled();

    const topicsTab = fixture.nativeElement.querySelector(
      '#community-tab-topics'
    ) as HTMLButtonElement;
    topicsTab.click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(topicRepositoryMock.getPage$).toHaveBeenCalledWith({
      communityId: 'community-1',
      limit: 12,
      cursor: null,
    });
    expect(fixture.nativeElement.textContent).toContain('Primeiro Tópico');
  });
});