import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import { CommunityFeedTimeTickerService } from '../feed/community-feed-time-ticker.service';
import { CommunityFeedCommentRepliesComponent } from './community-feed-comment-replies.component';

const CREATED_AT = Date.now() - 60_000;

describe('CommunityFeedCommentRepliesComponent', () => {
  const repositoryMock = {
    getRepliesPage$: vi.fn(),
    createReply$: vi.fn(),
    moderateReply$: vi.fn(),
  };
  const notificationMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
  };
  const globalErrorMock = { handleError: vi.fn() };
  const tickerMock = { now$: of(Date.now()) };
  const dialogMock = { open: vi.fn() };
  const routerMock = { url: '/dashboard/comunidades/community-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getRepliesPage$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));

    TestBed.configureTestingModule({
      imports: [CommunityFeedCommentRepliesComponent],
      providers: [
        { provide: CommunityFeedCommentRepository, useValue: repositoryMock },
        { provide: ErrorNotificationService, useValue: notificationMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
        { provide: CommunityFeedTimeTickerService, useValue: tickerMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: Router, useValue: routerMock },
      ],
    });
  });

  function create(canReply: boolean, replyCount = 0) {
    const fixture = TestBed.createComponent(CommunityFeedCommentRepliesComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('postId', 'post-1');
    fixture.componentRef.setInput('commentId', 'comment-1');
    fixture.componentRef.setInput('parentAuthorLabel', 'Pessoa participante');
    fixture.componentRef.setInput('initialReplyCount', replyCount);
    fixture.componentRef.setInput('canReply', canReply);
    fixture.detectChanges();
    return fixture;
  }

  it('não consulta respostas enquanto a thread está recolhida', () => {
    const fixture = create(true, 3);

    expect(fixture.nativeElement.textContent).toContain('3 respostas');
    expect(fixture.nativeElement.textContent).toContain('Responder');
    expect(repositoryMock.getRepliesPage$).not.toHaveBeenCalled();
  });

  it('visitante autenticado pode ler e denunciar resposta sem receber compositor', () => {
    repositoryMock.getRepliesPage$.mockReturnValue(of({
      items: [{
        replyId: 'reply-1',
        author: { label: 'Outra pessoa', avatarUrl: null },
        text: 'Resposta já publicada.',
        capabilities: {
          canDeleteOwn: false,
          canModerate: false,
          canReport: true,
        },
        createdAt: CREATED_AT,
      }],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    const fixture = create(false, 1);

    const openButton = fixture.nativeElement.querySelector(
      '.comment-replies__action'
    ) as HTMLButtonElement;
    openButton.click();
    fixture.detectChanges();

    expect(repositoryMock.getRepliesPage$).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain('Resposta já publicada.');
    expect(fixture.nativeElement.querySelector('.comment-replies__composer')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('app-report-content-button')
    ).not.toBeNull();
  });

  it('envia a resposta com Enter e mantém Shift+Enter disponível para edição', () => {
    repositoryMock.getRepliesPage$
      .mockReturnValueOnce(of({
        items: [],
        nextCursor: null,
        generatedAt: Date.now(),
      }))
      .mockReturnValueOnce(of({
        items: [{
          replyId: 'reply-created',
          author: { label: 'Eu', avatarUrl: null },
          text: 'Minha resposta.',
          capabilities: {
            canDeleteOwn: true,
            canModerate: false,
            canReport: false,
          },
          createdAt: CREATED_AT,
        }],
        nextCursor: null,
        generatedAt: Date.now(),
      }));
    repositoryMock.createReply$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-1',
      commentId: 'comment-1',
      replyId: 'reply-created',
      replyCount: 1,
      created: true,
      deduplicated: false,
    }));

    const fixture = create(true, 0);
    fixture.componentInstance.openComposer();
    fixture.detectChanges();
    fixture.componentInstance.replyControl.setValue('  Minha resposta.  ');
    fixture.detectChanges();

    const textarea = fixture.nativeElement.querySelector(
      '.comment-replies__composer textarea'
    ) as HTMLTextAreaElement;
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(enterEvent);
    fixture.detectChanges();

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(repositoryMock.createReply$).toHaveBeenCalledWith(expect.objectContaining({
      communityId: 'community-1',
      postId: 'post-1',
      commentId: 'comment-1',
      text: 'Minha resposta.',
    }));
    expect(fixture.componentInstance.displayReplyCount()).toBe(1);
    expect(fixture.componentInstance.replyControl.value).toBe('');
    expect(repositoryMock.getRepliesPage$).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('Minha resposta.');
    expect(fixture.nativeElement.querySelector('.comment-reply.is-recent')).not.toBeNull();
    expect(notificationMock.showSuccess).toHaveBeenCalledWith('Resposta publicada.');

    fixture.componentInstance.openComposer();
    fixture.detectChanges();
    fixture.componentInstance.replyControl.setValue('linha 1');
    const reopenedTextarea = fixture.nativeElement.querySelector(
      '.comment-replies__composer textarea'
    ) as HTMLTextAreaElement;
    const shiftEnterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    reopenedTextarea.dispatchEvent(shiftEnterEvent);

    expect(shiftEnterEvent.defaultPrevented).toBe(false);
    expect(repositoryMock.createReply$).toHaveBeenCalledTimes(1);
  });

  it('preserva o texto quando a publicação da resposta falha', () => {
    repositoryMock.createReply$.mockReturnValue(throwError(
      () => Object.assign(new Error('rate limited'), {
        code: 'functions/resource-exhausted',
      })
    ));
    const fixture = create(true, 0);

    fixture.componentInstance.openComposer();
    fixture.detectChanges();
    fixture.componentInstance.replyControl.setValue('Texto preservado');
    fixture.componentInstance.submitReply();
    fixture.detectChanges();

    expect(fixture.componentInstance.replyControl.value).toBe('Texto preservado');
    expect(notificationMock.showError).toHaveBeenCalledWith(
      'Você respondeu muitas vezes em pouco tempo. Aguarde um instante.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain(
      'Seu texto foi preservado. Tente novamente.'
    );
  });

  it('permite excluir a própria resposta e atualiza o contador autoritativo', () => {
    const ownReply = {
      replyId: 'reply-own',
      author: { label: 'Eu', avatarUrl: null },
      text: 'Resposta própria.',
      capabilities: {
        canDeleteOwn: true,
        canModerate: false,
        canReport: false,
      },
      createdAt: CREATED_AT,
    };
    repositoryMock.getRepliesPage$
      .mockReturnValueOnce(of({
        items: [ownReply],
        nextCursor: null,
        generatedAt: Date.now(),
      }))
      .mockReturnValueOnce(of({
        items: [],
        nextCursor: null,
        generatedAt: Date.now(),
      }));
    repositoryMock.moderateReply$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-1',
      commentId: 'comment-1',
      replyId: 'reply-own',
      action: 'delete_own',
      status: 'deleted',
      replyCount: 0,
      deduplicated: false,
      generatedAt: Date.now(),
    }));

    const fixture = create(true, 1);
    fixture.componentInstance.toggleReplies();
    fixture.detectChanges();
    fixture.componentInstance.requestAction(ownReply, 'delete_own');
    fixture.componentInstance.confirmAction(ownReply);
    fixture.detectChanges();

    expect(repositoryMock.moderateReply$).toHaveBeenCalledWith(expect.objectContaining({
      commentId: 'comment-1',
      replyId: 'reply-own',
      action: 'delete_own',
      reason: null,
    }));
    expect(fixture.componentInstance.displayReplyCount()).toBe(0);
    expect(notificationMock.showSuccess).toHaveBeenCalledWith('Resposta excluída.');
  });

  it('exige motivo para a gestão remover resposta', () => {
    const managedReply = {
      replyId: 'reply-managed',
      author: { label: 'Outra pessoa', avatarUrl: null },
      text: 'Resposta a moderar.',
      capabilities: {
        canDeleteOwn: false,
        canModerate: true,
        canReport: false,
      },
      createdAt: CREATED_AT,
    };
    repositoryMock.getRepliesPage$.mockReturnValue(of({
      items: [managedReply],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    repositoryMock.moderateReply$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-1',
      commentId: 'comment-1',
      replyId: 'reply-managed',
      action: 'remove',
      status: 'removed',
      replyCount: 0,
      deduplicated: false,
      generatedAt: Date.now(),
    }));

    const fixture = create(true, 1);
    fixture.componentInstance.toggleReplies();
    fixture.detectChanges();
    fixture.componentInstance.requestAction(managedReply, 'remove');
    fixture.componentInstance.confirmAction(managedReply);

    expect(repositoryMock.moderateReply$).not.toHaveBeenCalled();
    expect(notificationMock.showWarning).toHaveBeenCalledWith(
      'Informe o motivo da remoção.'
    );

    fixture.componentInstance.removalReason.setValue('Fora das regras');
    fixture.componentInstance.confirmAction(managedReply);

    expect(repositoryMock.moderateReply$).toHaveBeenCalledWith(expect.objectContaining({
      replyId: 'reply-managed',
      action: 'remove',
      reason: 'Fora das regras',
    }));
  });
});
