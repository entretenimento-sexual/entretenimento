import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityFeedComponent } from './community-feed.component';
import { CommunityFeedTimeTickerService } from './community-feed-time-ticker.service';

describe('CommunityFeedComponent shared location map', () => {
  function configureFixture(location: {
    latitude: number;
    longitude: number;
    precision: 'approximate' | 'precise';
    accuracyMeters: number | null;
  }) {
    const now = Date.now();
    const feedRepository = {
      getPage$: vi.fn().mockReturnValue(of({
        items: [{
          postId: 'location-post',
          kind: 'location',
          author: { label: 'serale', avatarUrl: null },
          text: 'Estamos aqui.',
          image: null,
          location,
          replyTo: null,
          metrics: { commentCount: 0, reactionCount: 0 },
          capabilities: {
            canDeleteOwn: false,
            canModerate: false,
            canReport: false,
            canReact: false,
            viewerReacted: false,
            canViewComments: true,
            canComment: true,
          },
          publishedAt: now,
        }],
        nextCursor: null,
        generatedAt: now,
      })),
      getItems$: vi.fn().mockReturnValue(of({
        items: [],
        nextCursor: null,
        generatedAt: now,
      })),
      watchLatestChanges$: vi.fn().mockReturnValue(of([])),
      createPost$: vi.fn(),
      moderatePost$: vi.fn(),
      toggleReaction$: vi.fn(),
    };
    const commentRepository = {
      getPage$: vi.fn().mockReturnValue(of({
        items: [],
        nextCursor: null,
        generatedAt: now,
      })),
      createComment$: vi.fn(),
      moderateComment$: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [CommunityFeedComponent],
      providers: [
        { provide: CommunityFeedRepository, useValue: feedRepository },
        { provide: CommunityFeedCommentRepository, useValue: commentRepository },
        { provide: CommunityFeedTimeTickerService, useValue: { now$: of(now) } },
        { provide: StorageService, useValue: { uploadFile: vi.fn() } },
        { provide: AuthSessionService, useValue: { currentAuthUser: { uid: 'user-1' } } },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });

    const fixture = TestBed.createComponent(CommunityFeedComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('view', 'feed');
    fixture.componentRef.setInput('sourceType', 'community');
    fixture.componentRef.setInput('canInteract', true);
    fixture.componentRef.setInput('viewerRole', 'member');
    fixture.detectChanges();
    return fixture;
  }

  it('preserva coordenadas precisas na visualização e no link externo', () => {
    const fixture = configureFixture({
      latitude: -22.912345,
      longitude: -43.187654,
      precision: 'precise',
      accuracyMeters: 8,
    });

    const map = fixture.nativeElement.querySelector(
      '.community-post__location-map iframe'
    ) as HTMLIFrameElement;
    const metadata = fixture.nativeElement.querySelector(
      '.community-post__location-meta'
    ) as HTMLElement;
    const externalLink = fixture.nativeElement.querySelector(
      '.community-post__location-link'
    ) as HTMLAnchorElement;

    expect(map).not.toBeNull();
    expect(map.getAttribute('src')).toBe(
      'https://www.google.com/maps?q=-22.912345,-43.187654&z=14&output=embed'
    );
    expect(map.getAttribute('title')).toContain('-22.912345, -43.187654');
    expect(metadata.textContent).toContain('Localização compartilhada');
    expect(metadata.textContent).toContain('-22.912345, -43.187654');

    expect(externalLink).not.toBeNull();
    expect(externalLink.textContent).toContain('Abrir mapa');
    expect(externalLink.href).toContain('https://www.google.com/maps/search/');
    expect(externalLink.href).toContain('query=-22.912345%2C-43.187654');
  });

  it('mantém posts legados aproximados em duas casas sem atribuir precisão retroativa', () => {
    const fixture = configureFixture({
      latitude: -22.912345,
      longitude: -43.187654,
      precision: 'approximate',
      accuracyMeters: null,
    });

    const map = fixture.nativeElement.querySelector(
      '.community-post__location-map iframe'
    ) as HTMLIFrameElement;
    const externalLink = fixture.nativeElement.querySelector(
      '.community-post__location-link'
    ) as HTMLAnchorElement;

    expect(map.getAttribute('src')).toBe(
      'https://www.google.com/maps?q=-22.91,-43.19&z=14&output=embed'
    );
    expect(externalLink.href).toContain('query=-22.91%2C-43.19');
  });
});
