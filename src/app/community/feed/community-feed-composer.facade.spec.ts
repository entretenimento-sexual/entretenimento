import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GeolocationService } from 'src/app/core/services/geolocation/geolocation.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import {
  CommunityFeedComposerContext,
  CommunityFeedComposerFacade,
} from './community-feed-composer.facade';

const context: CommunityFeedComposerContext = {
  communityId: 'community-1',
  view: 'feed',
  sourceType: 'community',
  canInteract: true,
};

describe('CommunityFeedComposerFacade', () => {
  const repositoryMock = {
    createPost$: vi.fn(),
  };
  const storageMock = {
    uploadFile: vi.fn(),
  };
  const authReady$ = new BehaviorSubject<boolean>(true);
  const authReadyUid$ = new BehaviorSubject<string | null>('u1');
  const authSessionMock = {
    ready$: authReady$.asObservable(),
    readyUid$: authReadyUid$.asObservable(),
  };
  const geolocationMock = {
    watchPosition$: vi.fn(),
  };
  const errorNotifierMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
  };
  const applicationErrorMock = {
    report: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.createPost$.mockReset();
    storageMock.uploadFile.mockReset();
    geolocationMock.watchPosition$.mockReset();
    authReady$.next(true);
    authReadyUid$.next('u1');

    TestBed.configureTestingModule({
      providers: [
        CommunityFeedComposerFacade,
        { provide: CommunityFeedRepository, useValue: repositoryMock },
        { provide: StorageService, useValue: storageMock },
        { provide: AuthSessionService, useValue: authSessionMock },
        { provide: GeolocationService, useValue: geolocationMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: ApplicationErrorService, useValue: applicationErrorMock },
      ],
    });
  });

  function createFacade(): CommunityFeedComposerFacade {
    return TestBed.inject(CommunityFeedComposerFacade);
  }

  it('mantém o composer compacto em foco/texto e expande apenas quando há conteúdo estrutural', () => {
    const facade = createFacade();

    facade.postForm.controls.text.setValue('Texto curto sem anexo.');
    facade.expandComposer(context);

    expect(facade.composerExpanded()).toBe(false);

    facade.selectedAttachment.set({
      kind: 'image',
      file: new File(['photo'], 'foto.webp', { type: 'image/webp' }),
      previewUrl: null,
    });
    facade.expandComposer(context);

    expect(facade.composerExpanded()).toBe(true);

    facade.removeSelectedPhoto();

    expect(facade.selectedAttachment()).toBeNull();
    expect(facade.composerExpanded()).toBe(false);
  });

  it('publica, emite o item criado e limpa o rascunho somente após sucesso', () => {
    repositoryMock.createPost$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-created',
      created: true,
      deduplicated: false,
    }));
    const facade = createFacade();
    const created: string[] = [];
    const states: string[] = [];
    facade.postCreated$.subscribe((result) => created.push(result.postId));
    facade.postCreateState$.subscribe((state) => states.push(state.status));
    facade.postForm.controls.text.setValue('Mensagem do Mural.');

    facade.submitPost(context);

    expect(repositoryMock.createPost$).toHaveBeenCalledWith(
      expect.objectContaining({
        communityId: 'community-1',
        text: 'Mensagem do Mural.',
        audience: 'members_only',
        imageUploadPath: null,
      })
    );
    expect(created).toEqual(['post-created']);
    expect(states).toContain('loading');
    expect(states.at(-1)).toBe('idle');
    expect(facade.postForm.controls.text.value).toBe('');
    expect(facade.selectedAttachment()).toBeNull();
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith('Mensagem enviada.');
  });

  it('preserva rascunho e anexo quando a criação do post falha', () => {
    storageMock.uploadFile.mockReturnValue(
      of('community-feed/u1/foto.webp')
    );
    repositoryMock.createPost$.mockReturnValue(
      throwError(() => ({
        code: 'functions/resource-exhausted',
        details: { reason: 'community_feed_rate_limited' },
      }))
    );
    const facade = createFacade();
    const file = new File(['photo'], 'foto.webp', { type: 'image/webp' });
    const attachment = {
      kind: 'image' as const,
      file,
      previewUrl: null,
    };
    facade.postCreateState$.subscribe();
    facade.postForm.controls.text.setValue('Rascunho importante.');
    facade.selectedAttachment.set(attachment);

    facade.submitPost(context);

    expect(storageMock.uploadFile).toHaveBeenCalledWith(
      file,
      'community-feed',
      'u1',
      expect.any(Function)
    );
    expect(repositoryMock.createPost$).toHaveBeenCalledWith(
      expect.objectContaining({
        communityId: 'community-1',
        text: 'Rascunho importante.',
        imageUploadPath: 'community-feed/u1/foto.webp',
      })
    );
    expect(facade.postForm.controls.text.value).toBe('Rascunho importante.');
    expect(facade.selectedAttachment()).toBe(attachment);
    expect(facade.composerExpanded()).toBe(true);
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        feature: 'community',
        operation: 'createPost',
      })
    );
  });

  it('centraliza falha de upload sem descartar foto ou legenda', () => {
    storageMock.uploadFile.mockReturnValue(
      throwError(() => new Error('storage unavailable'))
    );
    const facade = createFacade();
    const file = new File(['photo'], 'falha.webp', { type: 'image/webp' });
    facade.postCreateState$.subscribe();
    facade.postForm.controls.text.setValue('Legenda preservada.');
    facade.selectedAttachment.set({
      kind: 'image',
      file,
      previewUrl: null,
    });

    facade.submitPost(context);

    expect(storageMock.uploadFile).toHaveBeenCalledWith(
      file,
      'community-feed',
      'u1',
      expect.any(Function)
    );
    expect(repositoryMock.createPost$).not.toHaveBeenCalled();
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        feature: 'community',
        operation: 'uploadFeedImage',
        fallbackMessage: 'Não foi possível enviar a foto agora.',
      })
    );
    expect(facade.postForm.controls.text.value).toBe('Legenda preservada.');
    expect(facade.selectedAttachment()?.kind).toBe('image');
    expect(facade.uploadProgress()).toBeNull();
    expect(facade.composerExpanded()).toBe(true);
  });

  it('aguarda a sessão canônica pronta antes de iniciar upload e usa o UID reativo', () => {
    authReady$.next(false);
    authReadyUid$.next(null);
    storageMock.uploadFile.mockReturnValue(of('community-feed/u2/foto.webp'));
    repositoryMock.createPost$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-created',
      created: true,
      deduplicated: false,
    }));

    const facade = createFacade();
    const file = new File(['photo'], 'foto.webp', { type: 'image/webp' });
    facade.postCreateState$.subscribe();
    facade.postForm.controls.text.setValue('Foto com sessão reativa.');
    facade.selectedAttachment.set({ kind: 'image', file, previewUrl: null });

    facade.submitPost(context);

    expect(storageMock.uploadFile).not.toHaveBeenCalled();

    authReadyUid$.next('u2');
    authReady$.next(true);

    expect(storageMock.uploadFile).toHaveBeenCalledWith(
      file,
      'community-feed',
      'u2',
      expect.any(Function)
    );
    expect(repositoryMock.createPost$).toHaveBeenCalledWith(
      expect.objectContaining({ imageUploadPath: 'community-feed/u2/foto.webp' })
    );
  });

  it('falha com feedback específico quando a sessão pronta não possui UID', () => {
    authReady$.next(true);
    authReadyUid$.next(null);
    const facade = createFacade();
    const file = new File(['photo'], 'foto.webp', { type: 'image/webp' });
    facade.postCreateState$.subscribe();
    facade.selectedAttachment.set({ kind: 'image', file, previewUrl: null });

    facade.submitPost(context);

    expect(storageMock.uploadFile).not.toHaveBeenCalled();
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        feature: 'community',
        operation: 'uploadFeedImage',
        fallbackMessage: 'Sua sessão precisa ser atualizada para enviar a foto.',
      })
    );
    expect(facade.selectedAttachment()?.kind).toBe('image');
  });

  it('mantém a regra canônica de criação restrita ao Mural da Comunidade', () => {
    const facade = createFacade();

    expect(facade.canCreatePost(context)).toBe(true);
    expect(facade.canCreatePost({ ...context, view: 'photos' })).toBe(false);
    expect(facade.canCreatePost({ ...context, sourceType: 'venue' })).toBe(false);
    expect(facade.canCreatePost({ ...context, canInteract: false })).toBe(false);
  });
});
