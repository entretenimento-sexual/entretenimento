import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import {
  CommunityFeedComponent,
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed.component';
import { CommunityFeedPage } from '../data-access/community-feed.model';
import type { CommunityFeedRealtimeChange } from '../data-access/community-feed-realtime.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import { CommunityHighlightUiService } from '../highlight/community-highlight-ui.service';

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
        replyTo: null,
        metrics: { commentCount: 2, reactionCount: 5 },
        capabilities: {
          canDeleteOwn: false,
          canModerate: false,
          canReport: false,
          canReact: false,
          viewerReacted: false,
          canViewComments: false,
          canComment: false,
        },
        publishedAt: Date.now() - 60_000,
      },
    ],
    nextCursor,
    generatedAt: Date.now(),
  };
}

function textItem(postId: string, text: string) {
  return {
    postId,
    kind: 'text' as const,
    author: { label: 'Pessoa nova', avatarUrl: null },
    text,
    image: null,
    replyTo: null,
    metrics: { commentCount: 0, reactionCount: 0 },
    capabilities: {
      canDeleteOwn: false,
      canModerate: false,
      canReport: true,
      canReact: false,
      viewerReacted: false,
      canViewComments: true,
      canComment: false,
    },
    publishedAt: Date.now(),
  };
}

describe('CommunityFeedComponent', () => {
  const repositoryMock = {
    getPage$: vi.fn(),
    getItems$: vi.fn(),
    watchLatestChanges$: vi.fn(),
    createPost$: vi.fn(),
    moderatePost$: vi.fn(),
    toggleReaction$: vi.fn(),
  };
  const commentRepositoryMock = {
    getPage$: vi.fn(),
    createComment$: vi.fn(),
    moderateComment$: vi.fn(),
  };
  const highlightUiMock = {
    state$: vi.fn(() => of({
      status: 'ready' as const,
      communityId: 'community-1',
      highlight: null,
      item: null,
      canManage: false,
    })),
    manage$: vi.fn(),
    refresh: vi.fn(),
  };
  const storageMock = {
    uploadFile: vi.fn(),
  };
  const authSessionMock = {
    currentAuthUser: { uid: 'u1' },
  };
  const errorNotifierMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
  };
  const globalErrorMock = { handleError: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getPage$.mockReturnValue(of(page()));
    repositoryMock.getItems$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    repositoryMock.watchLatestChanges$.mockReturnValue(of([]));
    TestBed.configureTestingModule({
      imports: [CommunityFeedComponent],
      providers: [
        { provide: CommunityFeedRepository, useValue: repositoryMock },
        {
          provide: CommunityFeedCommentRepository,
          useValue: commentRepositoryMock,
        },
        { provide: CommunityHighlightUiService, useValue: highlightUiMock },
        { provide: StorageService, useValue: storageMock },
        { provide: AuthSessionService, useValue: authSessionMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  function create(
    view: 'feed' | 'photos' = 'feed',
    sourceType: 'community' | 'venue' = 'community',
    canInteract = false,
    viewerRole: 'owner' | 'admin' | 'moderator' | 'member' | null = null
  ) {
    const fixture = TestBed.createComponent(CommunityFeedComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('view', view);
    fixture.componentRef.setInput('sourceType', sourceType);
    fixture.componentRef.setInput('canInteract', canInteract);
    fixture.componentRef.setInput('viewerRole', viewerRole);
    fixture.detectChanges();
    return fixture;
  }

  it('renderiza mensagem com foto sem controles de interação', () => {
    const fixture = create('feed', 'venue');

    expect(fixture.nativeElement.textContent).toContain('Equipe do local');
    expect(fixture.nativeElement.textContent).toContain('Movimento tranquilo.');
    expect(fixture.nativeElement.querySelector('.community-post')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('button[aria-label*="Curtir"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.community-post__action--static')?.textContent)
      .toContain('5 curtidas');
    expect(
      fixture.nativeElement.querySelector('.community-feed')?.getAttribute('aria-label')
    ).toBe('Novidades do Local');
  });

  it('consulta a visualização de fotos como compilação da timeline', () => {
    const fixture = create('photos', 'venue');

    expect(repositoryMock.getPage$).toHaveBeenCalledWith(
      expect.objectContaining({ communityId: 'community-1', view: 'photos' })
    );
    expect(
      fixture.nativeElement.querySelector('.community-feed--photos')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.community-feed')?.getAttribute('aria-label')
    ).toBe('Fotos do Local');
  });

  it('aplica publicação realtime por hidratação dirigida sem recarregar a página', () => {
    const realtime$ = new Subject<readonly CommunityFeedRealtimeChange[]>();
    repositoryMock.watchLatestChanges$.mockReturnValue(realtime$);
    repositoryMock.getItems$.mockReturnValue(of({
      items: [textItem('post-2', 'Cheguei agora pelo realtime.')],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    const fixture = create('feed', 'community');

    realtime$.next([{
      type: 'added',
      projection: {
        postId: 'post-2',
        kind: 'text',
        state: 'active',
        metrics: { commentCount: 0, reactionCount: 0 },
        publishedAt: Date.now(),
        eventAt: Date.now(),
      },
    }]);
    fixture.detectChanges();

    expect(repositoryMock.getItems$).toHaveBeenCalledWith({
      communityId: 'community-1',
      view: 'feed',
      postIds: ['post-2'],
    });
    expect(repositoryMock.getPage$).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Cheguei agora pelo realtime.');
  });

  it('serializa hidratações realtime para não perder publicações em rajada', () => {
    const realtime$ = new Subject<readonly CommunityFeedRealtimeChange[]>();
    const firstHydration$ = new Subject<CommunityFeedPage>();
    const secondHydration$ = new Subject<CommunityFeedPage>();
    repositoryMock.watchLatestChanges$.mockReturnValue(realtime$);
    repositoryMock.getItems$
      .mockReturnValueOnce(firstHydration$)
      .mockReturnValueOnce(secondHydration$);
    const fixture = create('feed', 'community');
    const realtimeChange = (postId: string): CommunityFeedRealtimeChange => ({
      type: 'added',
      projection: {
        postId,
        kind: 'text',
        state: 'active',
        metrics: { commentCount: 0, reactionCount: 0 },
        publishedAt: Date.now(),
        eventAt: Date.now(),
      },
    });

    realtime$.next([realtimeChange('post-2')]);
    realtime$.next([realtimeChange('post-3')]);

    expect(repositoryMock.getItems$).toHaveBeenCalledTimes(1);
    expect(repositoryMock.getItems$).toHaveBeenLastCalledWith({
      communityId: 'community-1',
      view: 'feed',
      postIds: ['post-2'],
    });

    firstHydration$.next({
      items: [textItem('post-2', 'Primeiro post da rajada.')],
      nextCursor: null,
      generatedAt: Date.now(),
    });
    firstHydration$.complete();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Primeiro post da rajada.');
    expect(repositoryMock.getItems$).toHaveBeenCalledTimes(2);
    expect(repositoryMock.getItems$).toHaveBeenLastCalledWith({
      communityId: 'community-1',
      view: 'feed',
      postIds: ['post-3'],
    });

    secondHydration$.next({
      items: [textItem('post-3', 'Segundo post da rajada.')],
      nextCursor: null,
      generatedAt: Date.now(),
    });
    secondHydration$.complete();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Primeiro post da rajada.');
    expect(fixture.nativeElement.textContent).toContain('Segundo post da rajada.');
  });

  it('preserva conteúdo existente durante revalidação não paginada', () => {
    const ready = reduceCommunityFeedState(INITIAL_COMMUNITY_FEED_STATE, {
      type: 'success',
      request: { cursor: null, append: false, preserve: true },
      page: page('post-1'),
    });
    const refreshing = reduceCommunityFeedState(ready, {
      type: 'loading',
      request: { cursor: null, append: false, preserve: true },
    });

    expect(refreshing.status).toBe('ready');
    expect(refreshing.items).toHaveLength(1);
  });

  it('patch realtime atualiza métricas e tombstone remove o item', () => {
    const ready = reduceCommunityFeedState(INITIAL_COMMUNITY_FEED_STATE, {
      type: 'success',
      request: { cursor: null, append: false },
      page: page(),
    });
    const patched = reduceCommunityFeedState(ready, {
      type: 'realtime',
      upserts: [],
      metricPatches: [{
        postId: 'post-1',
        metrics: { commentCount: 9, reactionCount: 12 },
      }],
      removedIds: [],
    });
    const removed = reduceCommunityFeedState(patched, {
      type: 'realtime',
      upserts: [],
      metricPatches: [],
      removedIds: ['post-1'],
    });

    expect(patched.items[0].metrics).toEqual({ commentCount: 9, reactionCount: 12 });
    expect(removed.items).toHaveLength(0);
  });

  it('abre comentários autorizados também no item retornado pelo Mural', () => {
    const interactivePage = page();
    interactivePage.items[0].capabilities.canViewComments = true;
    interactivePage.items[0].capabilities.canComment = true;
    repositoryMock.getPage$.mockReturnValue(of(interactivePage));
    commentRepositoryMock.getPage$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    const fixture = create('feed', 'community', true, 'member');
    const toggle = fixture.nativeElement.querySelector(
      '.community-post__comments-toggle'
    ) as HTMLButtonElement;

    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      fixture.nativeElement.querySelector('app-community-feed-comments')
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector(
      'app-community-feed-comments textarea'
    )).not.toBeNull();
    expect(commentRepositoryMock.getPage$).toHaveBeenCalledWith(expect.objectContaining({
      communityId: 'community-1',
      postId: 'post-1',
    }));

    fixture.componentInstance.updateCommentCount(interactivePage.items[0], 4);
    fixture.detectChanges();
    expect(toggle.textContent).toContain('4');
  });

  it('mostra estados vazios coerentes por contexto', () => {
    repositoryMock.getPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: Date.now() })
    );

    const local = create('feed', 'venue');
    expect(local.nativeElement.textContent).toContain(
      'Nenhuma novidade publicada.'
    );

    const community = create('feed', 'community');
    expect(community.nativeElement.textContent).toContain(
      'Nenhuma mensagem no Mural ainda.'
    );

    const photos = create('photos', 'community');
    expect(photos.nativeElement.textContent).toContain(
      'Nenhuma foto compartilhada ainda.'
    );
  });

  it('mantém erro bloqueante inline e envia apenas diagnóstico técnico', () => {
    repositoryMock.getPage$.mockReturnValue(
      throwError(() => new Error('permission-denied'))
    );
    const fixture = create('feed', 'venue');

    expect(fixture.nativeElement.textContent).toContain(
      'Não foi possível carregar as novidades.'
    );
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
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

  it('permite ao membro enviar mensagem e hidrata somente o item confirmado', () => {
    repositoryMock.createPost$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-created',
      created: true,
      deduplicated: false,
    }));
    const fixture = create('feed', 'community', true, 'member');
    const component = fixture.componentInstance;

    component.expandComposer();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.community-feed__composer-options')
    ).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Visibilidade');

    component.postForm.controls.text.setValue('Uma atualização da Comunidade.');
    component.submitPost();
    fixture.detectChanges();

    expect(repositoryMock.createPost$).toHaveBeenCalledWith(
      expect.objectContaining({
        communityId: 'community-1',
        text: 'Uma atualização da Comunidade.',
        audience: 'members_only',
        imageUploadPath: null,
      })
    );
    expect(repositoryMock.getItems$).toHaveBeenCalledWith({
      communityId: 'community-1',
      view: 'feed',
      postIds: ['post-created'],
    });
    expect(repositoryMock.getPage$).toHaveBeenCalledTimes(1);
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith('Mensagem enviada.');
    expect(component.postForm.controls.text.value).toBe('');
  });

  it('envia foto e legenda pelo mesmo fluxo do Mural', () => {
    storageMock.uploadFile.mockReturnValue(
      of('users/u1/uploads/images/community-photo.webp')
    );
    repositoryMock.createPost$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-photo',
      created: true,
      deduplicated: false,
    }));
    const fixture = create('feed', 'community', true, 'member');
    const component = fixture.componentInstance;
    const file = new File(['photo'], 'agora.webp', { type: 'image/webp' });

    component.selectedAttachment.set({
      kind: 'image',
      file,
      previewUrl: null,
    });
    component.postForm.controls.text.setValue('Olha como está o local agora.');
    component.submitPost();
    fixture.detectChanges();

    expect(storageMock.uploadFile).toHaveBeenCalledWith(
      file,
      'community-feed',
      'u1',
      expect.any(Function)
    );
    expect(repositoryMock.createPost$).toHaveBeenCalledWith(
      expect.objectContaining({
        communityId: 'community-1',
        text: 'Olha como está o local agora.',
        imageUploadPath: 'users/u1/uploads/images/community-photo.webp',
      })
    );
    expect(component.selectedAttachment()).toBeNull();
  });

  it('permite foto sem texto e rejeita compositor realmente vazio', () => {
    storageMock.uploadFile.mockReturnValue(
      of('users/u1/uploads/images/photo-only.webp')
    );
    repositoryMock.createPost$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-photo-only',
      created: true,
      deduplicated: false,
    }));
    const fixture = create('feed', 'community', true, 'member');
    const component = fixture.componentInstance;

    component.submitPost();
    expect(errorNotifierMock.showWarning).toHaveBeenCalledWith(
      'Escreva uma mensagem ou adicione uma foto ou localização.'
    );
    expect(repositoryMock.createPost$).not.toHaveBeenCalled();

    component.selectedAttachment.set({
      kind: 'image',
      file: new File(['photo'], 'foto.png', { type: 'image/png' }),
      previewUrl: null,
    });
    component.submitPost();
    fixture.detectChanges();

    expect(repositoryMock.createPost$).toHaveBeenCalledWith(
      expect.objectContaining({ text: '' })
    );
  });

  it('não oferece seletor de audiência nem para a gestão', () => {
    repositoryMock.createPost$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-created',
      created: true,
      deduplicated: false,
    }));
    const fixture = create('feed', 'community', true, 'moderator');
    const component = fixture.componentInstance;

    component.expandComposer();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Prévia autenticada');
    expect(fixture.nativeElement.querySelector('input[name="audience"]')).toBeNull();

    component.postForm.controls.text.setValue('Aviso da moderação.');
    component.submitPost();

    expect(repositoryMock.createPost$).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'members_only' })
    );
  });

  it('preserva rascunho e foto quando a publicação falha', () => {
    repositoryMock.createPost$.mockReturnValue(
      throwError(() => ({
        code: 'functions/resource-exhausted',
        details: { reason: 'community_feed_rate_limited' },
      }))
    );
    const fixture = create('feed', 'community', true, 'member');
    const component = fixture.componentInstance;

    component.expandComposer();
    component.postForm.controls.text.setValue('Rascunho preservado.');
    component.submitPost();
    fixture.detectChanges();

    expect(component.postForm.controls.text.value).toBe('Rascunho preservado.');
    expect(fixture.nativeElement.textContent).toContain('Sua mensagem');
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Você atingiu o limite temporário de mensagens. Tente mais tarde.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });

  it('não mostra compositor para visitante, Fotos ou Local', () => {
    expect(create('feed', 'community').nativeElement.querySelector(
      '.community-feed__composer'
    )).toBeNull();
    expect(create('photos', 'community', true, 'member').nativeElement.querySelector(
      '.community-feed__composer'
    )).toBeNull();
    expect(create('feed', 'venue', true, 'owner').nativeElement.querySelector(
      '.community-feed__composer'
    )).toBeNull();
  });

  it('exclui a própria mensagem localmente sem recarregar o Mural inteiro', () => {
    const ownPage = page();
    ownPage.items[0].capabilities.canDeleteOwn = true;
    repositoryMock.getPage$.mockReturnValue(of(ownPage));
    repositoryMock.moderatePost$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-1',
      action: 'delete_own',
      status: 'deleted',
      deduplicated: false,
      generatedAt: Date.now(),
    }));
    const fixture = create('feed', 'community', true, 'member');
    const item = ownPage.items[0];

    fixture.componentInstance.requestPostAction(item, 'delete_own');
    fixture.componentInstance.confirmPostAction(item);
    fixture.detectChanges();

    expect(repositoryMock.moderatePost$).toHaveBeenCalledWith(
      expect.objectContaining({
        communityId: 'community-1',
        postId: 'post-1',
        action: 'delete_own',
        reason: null,
      })
    );
    expect(repositoryMock.getPage$).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).not.toContain('Movimento tranquilo.');
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith('Mensagem excluída.');
  });

  it('exige motivo para remoção da gestão e centraliza falha preservando confirmação', () => {
    const managedPage = page();
    managedPage.items[0].capabilities.canModerate = true;
    repositoryMock.getPage$.mockReturnValue(of(managedPage));
    repositoryMock.moderatePost$.mockReturnValue(
      throwError(() => new Error('permission-denied'))
    );
    const fixture = create('feed', 'community', true, 'moderator');
    const component = fixture.componentInstance;
    const item = managedPage.items[0];

    component.requestPostAction(item, 'remove');
    component.confirmPostAction(item);
    expect(repositoryMock.moderatePost$).not.toHaveBeenCalled();

    component.removalReason.setValue('Viola as regras da Comunidade.');
    component.confirmPostAction(item);
    fixture.detectChanges();

    expect(repositoryMock.moderatePost$).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'remove', reason: 'Viola as regras da Comunidade.' })
    );
    expect(component.actionPostId()).toBe('post-1');
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Não foi possível remover a mensagem agora.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });

  it('aplica reação otimista, envia o estado desejado e reconcilia o backend', () => {
    const interactivePage = page();
    interactivePage.items[0].capabilities.canReact = true;
    repositoryMock.getPage$.mockReturnValue(of(interactivePage));
    const response$ = new Subject<{
      communityId: string;
      postId: string;
      reacted: boolean;
      reactionCount: number;
    }>();
    repositoryMock.toggleReaction$.mockReturnValue(response$);
    const fixture = create('feed', 'community', true, 'member');
    const component = fixture.componentInstance;
    const item = interactivePage.items[0];

    component.toggleReaction(item);
    fixture.detectChanges();
    expect(component.viewerReacted(item)).toBe(true);
    expect(component.reactionCount(item)).toBe(6);
    expect(fixture.nativeElement.querySelector('.community-post__reaction')?.textContent)
      .toContain('Curtido');

    response$.next({
      communityId: 'community-1',
      postId: 'post-1',
      reacted: true,
      reactionCount: 6,
    });
    response$.complete();
    fixture.detectChanges();

    expect(repositoryMock.toggleReaction$).toHaveBeenCalledWith({
      communityId: 'community-1',
      postId: 'post-1',
      reacted: true,
    });
    expect(component.viewerReacted(item)).toBe(true);
    expect(component.reactionCount(item)).toBe(6);
  });

  it('faz rollback da reação otimista e centraliza uma falha', () => {
    const interactivePage = page();
    interactivePage.items[0].capabilities.canReact = true;
    repositoryMock.getPage$.mockReturnValue(of(interactivePage));
    repositoryMock.toggleReaction$.mockReturnValue(
      throwError(() => ({ code: 'functions/resource-exhausted' }))
    );
    const fixture = create('feed', 'community', true, 'member');
    const component = fixture.componentInstance;

    component.toggleReaction(interactivePage.items[0]);
    fixture.detectChanges();

    expect(component.viewerReacted(interactivePage.items[0])).toBe(false);
    expect(component.reactionCount(interactivePage.items[0])).toBe(5);
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Você reagiu muitas vezes em pouco tempo. Aguarde um instante.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });
});
