import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityTopicRepository } from '../data-access/community-topic.repository';
import { CommunityTopicsComponent } from './community-topics.component';

const now = Date.now();
const topic = {
  topicId: 'topic-1',
  title: 'Boas práticas da Comunidade',
  excerpt: 'Conversa organizada para consulta posterior.',
  author: { label: 'Pessoa', avatarUrl: null },
  status: 'active' as const,
  metrics: { replyCount: 1, reactionCount: 0 },
  createdAt: now - 10_000,
  lastActivityAt: now - 1_000,
};

const reply = {
  replyId: 'reply-1',
  body: 'Primeira resposta.',
  author: { label: 'Outra pessoa', avatarUrl: null },
  createdAt: now - 500,
};

describe('CommunityTopicsComponent', () => {
  const repositoryMock = {
    getPage$: vi.fn(),
    getDetail$: vi.fn(),
    getRepliesPage$: vi.fn(),
    createTopic$: vi.fn(),
    createReply$: vi.fn(),
  };
  const errorNotifierMock = { showError: vi.fn(), showSuccess: vi.fn() };
  const globalErrorMock = { handleError: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getPage$.mockReturnValue(
      of({ items: [topic], nextCursor: null, generatedAt: now })
    );
    repositoryMock.getDetail$.mockReturnValue(
      of({
        topic: { ...topic, body: 'Texto integral do Tópico.' },
        canReply: true,
        generatedAt: now,
      })
    );
    repositoryMock.getRepliesPage$.mockReturnValue(
      of({ items: [reply], nextCursor: null, generatedAt: now })
    );
    repositoryMock.createTopic$.mockReturnValue(
      of({
        communityId: 'community-1',
        topicId: 'topic-created',
        created: true,
        deduplicated: false,
      })
    );
    repositoryMock.createReply$.mockReturnValue(
      of({
        communityId: 'community-1',
        topicId: 'topic-1',
        replyId: 'reply-created',
        replyCount: 2,
        created: true,
        deduplicated: false,
      })
    );

    TestBed.configureTestingModule({
      imports: [CommunityTopicsComponent],
      providers: [
        { provide: CommunityTopicRepository, useValue: repositoryMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  function createFixture(
    canInteract = false,
    viewerRole: 'member' | null = null
  ) {
    const fixture = TestBed.createComponent(CommunityTopicsComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('canInteract', canInteract);
    fixture.componentRef.setInput('viewerRole', viewerRole);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it('carrega lista de Tópicos apenas pela repository', () => {
    const fixture = createFixture();

    expect(repositoryMock.getPage$).toHaveBeenCalledWith({
      communityId: 'community-1',
      limit: 12,
      cursor: null,
    });
    expect(fixture.nativeElement.textContent).toContain('Boas práticas da Comunidade');
    expect(fixture.nativeElement.textContent).toContain('1 resposta');
    expect(fixture.nativeElement.textContent).not.toContain('Nova discussão');
  });

  it('explica escrita restrita sem induzir visitante a uma ação impossível', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain(
      'Somente membros podem publicar'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Participe da Comunidade para publicar'
    );
  });

  it('diferencia membro sem permissão de interação de um visitante', () => {
    const fixture = createFixture(false, 'member');

    expect(fixture.nativeElement.textContent).toContain(
      'Sua participação atual não permite publicar'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Somente membros podem publicar'
    );
  });

  it('visitante acompanha Tópico e respostas sem receber compositor de resposta', () => {
    repositoryMock.getDetail$.mockReturnValue(
      of({
        topic: { ...topic, body: 'Texto integral do Tópico.' },
        canReply: false,
        generatedAt: now,
      })
    );
    const fixture = createFixture();
    const card = fixture.nativeElement.querySelector(
      '.community-topics__card'
    ) as HTMLButtonElement;

    card.click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Texto integral do Tópico.');
    expect(fixture.nativeElement.textContent).toContain('Primeira resposta.');
    expect(fixture.nativeElement.textContent).toContain(
      'Você pode acompanhar a discussão, mas não responder neste momento.'
    );
    expect(
      fixture.nativeElement.querySelector('.community-topics__reply-composer')
    ).toBeNull();
  });

  it('abre detalhe em modo focado e volta para a lista preservada', () => {
    const fixture = createFixture();
    const browse = fixture.nativeElement.querySelector(
      '.community-topics__browse'
    ) as HTMLDivElement;
    const card = fixture.nativeElement.querySelector(
      '.community-topics__card'
    ) as HTMLButtonElement;

    expect(browse.hidden).toBe(false);
    card.click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(browse.hidden).toBe(true);
    expect(fixture.nativeElement.querySelector('#community-topic-detail')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Nova discussão');

    const back = fixture.nativeElement.querySelector(
      '.community-topics__back'
    ) as HTMLButtonElement;
    back.click();
    fixture.detectChanges();

    expect(browse.hidden).toBe(false);
    expect(fixture.nativeElement.querySelector('#community-topic-detail')).toBeNull();
    expect(repositoryMock.getPage$).toHaveBeenCalledTimes(1);
  });

  it('abre detalhe e respostas somente após selecionar um Tópico', () => {
    const fixture = createFixture();

    expect(repositoryMock.getDetail$).not.toHaveBeenCalled();
    expect(repositoryMock.getRepliesPage$).not.toHaveBeenCalled();

    const card = fixture.nativeElement.querySelector(
      '.community-topics__card'
    ) as HTMLButtonElement;
    card.click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(repositoryMock.getDetail$).toHaveBeenCalledWith({
      communityId: 'community-1',
      topicId: 'topic-1',
    });
    expect(repositoryMock.getRepliesPage$).toHaveBeenCalledWith({
      communityId: 'community-1',
      topicId: 'topic-1',
      limit: 20,
      cursor: null,
    });
    expect(fixture.nativeElement.textContent).toContain('Texto integral do Tópico.');
    expect(fixture.nativeElement.textContent).toContain('Primeira resposta.');
  });

  it('preserva discussões carregadas e oferece retry quando carregar mais falha', () => {
    repositoryMock.getPage$
      .mockReturnValueOnce(
        of({ items: [topic], nextCursor: 'topic-cursor', generatedAt: now })
      )
      .mockReturnValueOnce(
        throwError(() => ({ code: 'functions/unavailable' }))
      );
    const fixture = createFixture();
    const component = fixture.componentInstance;

    component.loadMoreTopics('topic-cursor');
    fixture.detectChanges();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Boas práticas da Comunidade');
    expect(fixture.nativeElement.textContent).toContain(
      'Não foi possível carregar mais discussões. As já carregadas foram preservadas.'
    );
    expect(fixture.nativeElement.textContent).toContain('Tentar novamente');
  });

  it('informa quando Tópico encerrado não aceita resposta', () => {
    repositoryMock.getDetail$.mockReturnValue(
      of({
        topic: { ...topic, status: 'locked' as const, body: 'Tópico encerrado.' },
        canReply: false,
        generatedAt: now,
      })
    );

    const fixture = createFixture();
    (fixture.nativeElement.querySelector('.community-topics__card') as HTMLButtonElement).click();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Esta discussão está encerrada para novas respostas.'
    );
  });

  it('publica novo Tópico sem oferecer audiência por publicação e abre o resultado', () => {
    const fixture = createFixture(true);
    const component = fixture.componentInstance;

    expect(fixture.nativeElement.textContent).toContain('Nova discussão');
    component.toggleComposer();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Quem pode ler');
    expect(fixture.nativeElement.querySelector('#community-topic-audience')).toBeNull();

    component.topicForm.setValue({
      title: 'Segurança e convivência',
      body: 'Quais práticas devemos manter neste espaço?',
    });
    component.submitTopic();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(repositoryMock.createTopic$).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^topic:/),
      communityId: 'community-1',
      title: 'Segurança e convivência',
      body: 'Quais práticas devemos manter neste espaço?',
      audience: 'members_only',
    });
    expect(component.selectedTopicId()).toBe('topic-created');
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith('Discussão publicada.');
  });

  it('reutiliza requestId após falha quando o rascunho do Tópico não mudou', () => {
    repositoryMock.createTopic$
      .mockReturnValueOnce(throwError(() => ({ code: 'functions/unavailable' })))
      .mockReturnValueOnce(
        of({
          communityId: 'community-1',
          topicId: 'topic-created',
          created: false,
          deduplicated: true,
        })
      );

    const fixture = createFixture(true);
    const component = fixture.componentInstance;
    component.toggleComposer();
    fixture.detectChanges();
    component.topicForm.setValue({
      title: 'Mesmo rascunho',
      body: 'Conteúdo que será reenviado com segurança.',
    });

    component.submitTopic();
    fixture.detectChanges();
    component.submitTopic();
    fixture.detectChanges();

    const firstRequest = repositoryMock.createTopic$.mock.calls[0][0];
    const secondRequest = repositoryMock.createTopic$.mock.calls[1][0];
    expect(secondRequest.requestId).toBe(firstRequest.requestId);
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith('Discussão confirmada.');
  });

  it('publica resposta e atualiza detalhe, respostas e lista', () => {
    const fixture = createFixture(true);
    const component = fixture.componentInstance;
    (fixture.nativeElement.querySelector('.community-topics__card') as HTMLButtonElement).click();
    fixture.detectChanges();
    fixture.detectChanges();

    component.replyForm.setValue({ body: 'Uma resposta nova e objetiva.' });
    component.submitReply(true);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(repositoryMock.createReply$).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^reply:/),
      communityId: 'community-1',
      topicId: 'topic-1',
      body: 'Uma resposta nova e objetiva.',
    });
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith('Resposta publicada.');
    expect(repositoryMock.getPage$).toHaveBeenCalledTimes(2);
    expect(repositoryMock.getDetail$).toHaveBeenCalledTimes(2);
    expect(repositoryMock.getRepliesPage$).toHaveBeenCalledTimes(2);
  });

  it('mantém erro bloqueante de listagem inline sem snackbar duplicado', () => {
    repositoryMock.getPage$.mockReturnValue(
      throwError(() => new Error('falha controlada'))
    );

    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).toContain(
      'Não foi possível carregar as discussões.'
    );
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });

  it('traduz reason estruturado ao criar discussão sem expor detalhe técnico', () => {
    repositoryMock.createTopic$.mockReturnValue(
      throwError(() => ({
        code: 'functions/resource-exhausted',
        message: 'internal rate detail',
        details: { reason: 'community_topic_rate_limited' },
      }))
    );
    const fixture = createFixture(true);
    const component = fixture.componentInstance;
    component.toggleComposer();
    fixture.detectChanges();
    component.topicForm.setValue({
      title: 'Discussão válida',
      body: 'Mensagem válida para testar o contrato de erro.',
    });

    component.submitTopic();
    fixture.detectChanges();

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Você atingiu o limite temporário de interações em Discussões. Tente novamente mais tarde.'
    );
    expect(errorNotifierMock.showError.mock.calls[0]?.[0]).not.toContain(
      'internal rate detail'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
    expect(component.topicForm.controls.body.value).toBe(
      'Mensagem válida para testar o contrato de erro.'
    );
  });
});
