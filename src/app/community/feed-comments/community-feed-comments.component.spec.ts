import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  CommunityFeedCommentItem,
  CommunityFeedCommentPage,
} from '../data-access/community-feed-comment.model';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityFeedCommentsComponent } from './community-feed-comments.component';

const CREATED_AT = Date.now() - 60_000;

function item(
  overrides: Partial<CommunityFeedCommentItem> = {}
): CommunityFeedCommentItem {
  return {
    commentId: 'comment-1',
    author: { label: 'Pessoa participante', avatarUrl: null },
    text: 'Mensagem carregada.',
    replyTo: null,
    replyCount: 0,
    capabilities: {
      canDeleteOwn: false,
      canModerate: false,
      canReport: false,
    },
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function page(
  items: readonly CommunityFeedCommentItem[] = [item()],
  nextCursor: string | null = null
): CommunityFeedCommentPage {
  return { items, nextCursor, generatedAt: Date.now() };
}

describe('CommunityFeedCommentsComponent', () => {
  const repositoryMock = {
    getPage$: vi.fn(),
    getRepliesPage$: vi.fn(),
    watchCommentCount$: vi.fn(),
    createComment$: vi.fn(),
    createReply$: vi.fn(),
    moderateComment$: vi.fn(),
    moderateReply$: vi.fn(),
  };
  const feedRepositoryMock = {
    createPost$: vi.fn(),
  };
  const notificationMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
  };
  const globalErrorMock = { handleError: vi.fn() };
  const dialogMock = { open: vi.fn() };
  const routerMock = { url: '/dashboard/comunidades/community-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.watchCommentCount$.mockReturnValue(of(0));
    repositoryMock.getRepliesPage$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    TestBed.configureTestingModule({
      imports: [CommunityFeedCommentsComponent],
      providers: [
        { provide: CommunityFeedCommentRepository, useValue: repositoryMock },
        { provide: CommunityFeedRepository, useValue: feedRepositoryMock },
        { provide: ErrorNotificationService, useValue: notificationMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: Router, useValue: routerMock },
      ],
    });
  });

  function create(canComment = false) {
    const fixture = TestBed.createComponent(CommunityFeedCommentsComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('postId', 'post-1');
    fixture.componentRef.setInput('canComment', canComment);
    fixture.detectChanges();
    return fixture;
  }

  it('permite leitura ao visitante sem expor compositor ou ação Responder', () => {
    repositoryMock.getPage$.mockReturnValue(of(page()));

    const fixture = create(false);

    expect(fixture.nativeElement.textContent).toContain('Mensagem carregada.');
    expect(fixture.nativeElement.textContent).toContain(
      'Apenas participantes ativos podem enviar mensagens.'
    );
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(fixture.nativeElement.querySelector('.feed-comment__actions button')).toBeNull();
  });

  it('mantém falha de carga na conversa sem toast redundante', () => {
    repositoryMock.getPage$.mockReturnValue(throwError(
      () => Object.assign(new Error('load failed'), {
        code: 'functions/unavailable',
      })
    ));

    const fixture = create(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Não foi possível carregar os comentários.'
    );
    expect(fixture.nativeElement.textContent).toContain('Tentar novamente');
    expect(notificationMock.showError).not.toHaveBeenCalled();
    expect(globalErrorMock.handleError).toHaveBeenCalledOnce();
  });

  it('oferece Responder somente na mensagem e abre uma citação no compositor', () => {
    repositoryMock.getPage$.mockReturnValue(of(page()));
    const fixture = create(true);
    const replyButton = fixture.nativeElement.querySelector(
      '.feed-comment__actions button'
    ) as HTMLButtonElement;

    expect(replyButton.textContent).toContain('Responder');
    replyButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.replyTarget()?.commentId).toBe('comment-1');
    expect(fixture.nativeElement.textContent).toContain(
      'Respondendo a Pessoa participante'
    );
    expect(fixture.nativeElement.textContent).toContain('Mensagem carregada.');
  });

  it('envia resposta como mensagem plana referenciando a mensagem original', () => {
    const target = item();
    const createdReply = item({
      commentId: 'comment-reply-flat',
      author: { label: 'Quem respondeu', avatarUrl: null },
      text: 'Resposta na mesma timeline.',
      createdAt: CREATED_AT + 1_000,
      replyTo: {
        commentId: 'comment-1',
        authorLabel: 'Pessoa participante',
        textPreview: 'Mensagem carregada.',
        available: true,
      },
    });
    repositoryMock.getPage$
      .mockReturnValueOnce(of(page([target])))
      .mockReturnValueOnce(of(page([createdReply, target])));
    repositoryMock.createComment$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-1',
      commentId: 'comment-reply-flat',
      commentCount: 2,
      created: true,
      deduplicated: false,
    }));
    const fixture = create(true);

    fixture.componentInstance.startReply(target);
    fixture.componentInstance.commentControl.setValue('Resposta na mesma timeline.');
    fixture.componentInstance.submitComment();
    fixture.detectChanges();

    expect(repositoryMock.createComment$).toHaveBeenCalledWith(expect.objectContaining({
      communityId: 'community-1',
      postId: 'post-1',
      replyToCommentId: 'comment-1',
      text: 'Resposta na mesma timeline.',
    }));
    expect(repositoryMock.createReply$).not.toHaveBeenCalled();
    expect(feedRepositoryMock.createPost$).not.toHaveBeenCalled();
    expect(fixture.componentInstance.replyTarget()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Resposta na mesma timeline.');
    expect(fixture.nativeElement.querySelector('.feed-comment__quote')).not.toBeNull();
    expect(notificationMock.showSuccess).toHaveBeenCalledWith('Resposta enviada.');
  });

  it('leva à mensagem citada e aplica destaque temporário', () => {
    const original = item();
    const reply = item({
      commentId: 'comment-2',
      text: 'Concordo.',
      createdAt: CREATED_AT + 1_000,
      replyTo: {
        commentId: 'comment-1',
        authorLabel: 'Pessoa participante',
        textPreview: 'Mensagem carregada.',
        available: true,
      },
    });
    repositoryMock.getPage$.mockReturnValue(of(page([reply, original])));
    const fixture = create(true);
    const originalElement = fixture.nativeElement.querySelector(
      '#community-conversation-message-comment-1'
    ) as HTMLElement;
    const scrollSpy = vi.fn();
    Object.defineProperty(originalElement, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    });

    (fixture.nativeElement.querySelector('.feed-comment__quote') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(fixture.componentInstance.highlightedCommentId()).toBe('comment-1');
  });

  it('revalida a conversa por realtime sem apagar mensagens visíveis', () => {
    const count$ = new Subject<number>();
    const refresh$ = new Subject<CommunityFeedCommentPage>();
    repositoryMock.watchCommentCount$.mockReturnValue(count$);
    repositoryMock.getPage$
      .mockReturnValueOnce(of(page([item()])))
      .mockReturnValueOnce(refresh$);
    const fixture = create(false);
    const counts: number[] = [];
    fixture.componentInstance.commentCountChanged.subscribe((count) => counts.push(count));

    count$.next(1);
    count$.next(2);
    fixture.detectChanges();

    expect(repositoryMock.getPage$).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('Mensagem carregada.');

    refresh$.next(page([
      item({ commentId: 'comment-2', text: 'Mensagem em tempo real.' }),
      item(),
    ]));
    refresh$.complete();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Mensagem em tempo real.');
    expect(counts).toEqual([2]);
  });

  it('publica resposta à raiz no Mural canônico e encerra a conversa legada', () => {
    repositoryMock.getPage$.mockReturnValue(of(page([])));
    feedRepositoryMock.createPost$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'feed-reply-1',
      created: true,
      deduplicated: false,
    }));
    const fixture = create(true);
    const closeSpy = vi.fn();
    const createdSpy = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closeSpy);
    fixture.componentInstance.feedPostCreated.subscribe(createdSpy);
    fixture.componentInstance.commentControl.setValue('  Minha contribuição.  ');
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector(
      '.feed-comments__composer'
    ) as HTMLFormElement;
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);
    fixture.detectChanges();

    expect(submitEvent.defaultPrevented).toBe(true);
    expect(feedRepositoryMock.createPost$).toHaveBeenCalledWith(expect.objectContaining({
      communityId: 'community-1',
      text: 'Minha contribuição.',
      audience: 'members_only',
      imageUploadPath: null,
      replyToPostId: 'post-1',
    }));
    expect(repositoryMock.createComment$).not.toHaveBeenCalled();
    expect(fixture.componentInstance.commentControl.value).toBe('');
    expect(createdSpy).toHaveBeenCalledWith('feed-reply-1');
    expect(closeSpy).toHaveBeenCalledOnce();
    expect(notificationMock.showSuccess).toHaveBeenCalledWith(
      'Resposta publicada no Mural.'
    );
  });

  it('envia com Enter e preserva Shift+Enter para quebra de linha', () => {
    repositoryMock.getPage$.mockReturnValue(of(page([])));
    feedRepositoryMock.createPost$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'feed-enter',
      created: true,
      deduplicated: false,
    }));

    const fixture = create(true);
    fixture.componentInstance.commentControl.setValue('Enviado pelo teclado.');
    fixture.detectChanges();
    const textarea = fixture.nativeElement.querySelector(
      '.feed-comments__composer textarea'
    ) as HTMLTextAreaElement;
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    });

    textarea.dispatchEvent(enterEvent);
    fixture.detectChanges();

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(feedRepositoryMock.createPost$).toHaveBeenCalledOnce();
    expect(repositoryMock.createComment$).not.toHaveBeenCalled();

    fixture.componentInstance.commentControl.setValue('linha 1');
    const shiftEnterEvent = new KeyboardEvent('keydown', {
      key: 'Enter', shiftKey: true, bubbles: true, cancelable: true,
    });
    textarea.dispatchEvent(shiftEnterEvent);

    expect(shiftEnterEvent.defaultPrevented).toBe(false);
    expect(feedRepositoryMock.createPost$).toHaveBeenCalledOnce();
  });

  it('preserva texto e alvo da resposta quando o envio falha', () => {
    repositoryMock.getPage$.mockReturnValue(of(page()));
    repositoryMock.createComment$.mockReturnValue(throwError(
      () => Object.assign(new Error('rate limited'), {
        code: 'functions/resource-exhausted',
      })
    ));
    const fixture = create(true);
    const target = item();
    fixture.componentInstance.startReply(target);
    fixture.componentInstance.commentControl.setValue('Texto preservado');

    fixture.componentInstance.submitComment();
    fixture.detectChanges();

    expect(fixture.componentInstance.commentControl.value).toBe('Texto preservado');
    expect(fixture.componentInstance.replyTarget()?.commentId).toBe('comment-1');
    expect(notificationMock.showError).toHaveBeenCalledWith(
      'Você enviou muitas mensagens em pouco tempo. Aguarde um instante.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledOnce();
  });

  it('exige motivo e permite à gestão remover mensagem', () => {
    const managed = item({
      capabilities: {
        canDeleteOwn: false,
        canModerate: true,
        canReport: false,
      },
    });
    repositoryMock.getPage$.mockReturnValue(of(page([managed])));
    repositoryMock.moderateComment$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-1',
      commentId: managed.commentId,
      action: 'remove',
      status: 'removed',
      commentCount: 0,
      deduplicated: false,
      generatedAt: Date.now(),
    }));
    const fixture = create(true);

    fixture.componentInstance.requestAction(managed, 'remove');
    fixture.componentInstance.confirmAction(managed);
    expect(repositoryMock.moderateComment$).not.toHaveBeenCalled();

    fixture.componentInstance.removalReason.setValue('Viola as regras');
    fixture.componentInstance.confirmAction(managed);
    fixture.detectChanges();

    expect(repositoryMock.moderateComment$).toHaveBeenCalledWith(expect.objectContaining({
      commentId: 'comment-1',
      action: 'remove',
      reason: 'Viola as regras',
    }));
  });

  it('pagina mensagens anteriores no início sem duplicar a timeline', () => {
    const recent = item({
      commentId: 'comment-2',
      text: 'Mensagem recente.',
      createdAt: CREATED_AT + 2_000,
    });
    const older = item({
      commentId: 'comment-1',
      text: 'Mensagem anterior.',
      createdAt: CREATED_AT,
    });
    repositoryMock.getPage$
      .mockReturnValueOnce(of(page([recent], 'comment-2')))
      .mockReturnValueOnce(of(page([recent, older])));
    const fixture = create();

    fixture.componentInstance.loadMore('comment-2');
    fixture.detectChanges();

    const rendered = Array.from(
      fixture.nativeElement.querySelectorAll('.feed-comment__surface > p')
    ).map((element) => (element as HTMLElement).textContent?.trim());
    expect(rendered).toEqual(['Mensagem anterior.', 'Mensagem recente.']);
  });

  it('oferece fechamento explícito da conversa', () => {
    repositoryMock.getPage$.mockReturnValue(of(page()));
    const fixture = create(false);
    const closeSpy = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closeSpy);

    (fixture.nativeElement.querySelector('.feed-comments__close') as HTMLButtonElement).click();
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});
