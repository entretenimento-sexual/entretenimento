import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  CommunityFeedComponent,
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed.component';
import { CommunityFeedPage } from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';

function page(nextCursor: string | null = null): CommunityFeedPage {
  return {
    items: [
      {
        postId: 'post-1',
        kind: 'photo',
        author: { label: 'Equipe do local', avatarUrl: null },
        text: 'Movimento tranquilo.',
        image: {
          url: 'https://example.com/photo.webp',
          alt: 'Foto do local',
        },
        metrics: { commentCount: 2, reactionCount: 5 },
        publishedAt: Date.now() - 60_000,
      },
    ],
    nextCursor,
    generatedAt: Date.now(),
  };
}

describe('CommunityFeedComponent', () => {
  const repositoryMock = { getPage$: vi.fn() };
  const errorNotifierMock = { showError: vi.fn() };
  const globalErrorMock = { handleError: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [CommunityFeedComponent],
      providers: [
        { provide: CommunityFeedRepository, useValue: repositoryMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  function create(view: 'feed' | 'photos' = 'feed') {
    const fixture = TestBed.createComponent(CommunityFeedComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('view', view);
    fixture.detectChanges();
    return fixture;
  }

  it('renderiza publicação sem controles de interação', () => {
    repositoryMock.getPage$.mockReturnValue(of(page()));
    const fixture = create();

    expect(fixture.nativeElement.textContent).toContain('Equipe do local');
    expect(fixture.nativeElement.textContent).toContain('Movimento tranquilo.');
    expect(fixture.nativeElement.querySelector('.community-post')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label*="Curtir"]')).toBeNull();
  });

  it('consulta a visualização de fotos e aplica grade contextual', () => {
    repositoryMock.getPage$.mockReturnValue(of(page()));
    const fixture = create('photos');

    expect(repositoryMock.getPage$).toHaveBeenCalledWith(
      expect.objectContaining({ communityId: 'community-1', view: 'photos' })
    );
    expect(
      fixture.nativeElement.querySelector('.community-feed--photos')
    ).not.toBeNull();
  });

  it('mostra estado vazio enxuto', () => {
    repositoryMock.getPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: Date.now() })
    );
    const fixture = create('photos');

    expect(fixture.nativeElement.textContent).toContain('Nenhuma foto disponível.');
  });

  it('centraliza feedback e diagnóstico em falha', () => {
    repositoryMock.getPage$.mockReturnValue(
      throwError(() => new Error('permission-denied'))
    );
    const fixture = create();

    expect(fixture.nativeElement.textContent).toContain('Não foi possível carregar.');
    expect(errorNotifierMock.showError).toHaveBeenCalledTimes(1);
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });

  it('mantém itens atuais quando página adicional falha', () => {
    const ready = reduceCommunityFeedState(INITIAL_COMMUNITY_FEED_STATE, {
      type: 'success',
      request: { cursor: null, append: false },
      page: page('post-1'),
    });
    const afterError = reduceCommunityFeedState(ready, {
      type: 'error',
      request: { cursor: 'post-1', append: true },
    });

    expect(afterError.status).toBe('ready');
    expect(afterError.items).toHaveLength(1);
    expect(afterError.loadingMore).toBe(false);
  });
});
