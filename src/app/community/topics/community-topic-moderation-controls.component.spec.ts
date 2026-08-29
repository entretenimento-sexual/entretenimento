import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityTopicRepository } from '../data-access/community-topic.repository';
import { CommunityTopicModerationControlsComponent } from './community-topic-moderation-controls.component';

describe('CommunityTopicModerationControlsComponent', () => {
  const repositoryMock = { moderateTopic$: vi.fn() };
  const errorNotifierMock = { showError: vi.fn(), showSuccess: vi.fn() };
  const globalErrorMock = { handleError: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.moderateTopic$.mockReturnValue(
      of({
        communityId: 'community-1',
        topicId: 'topic-1',
        action: 'lock',
        status: 'locked',
        moderationState: 'active',
        deduplicated: false,
        generatedAt: Date.now(),
      })
    );

    TestBed.configureTestingModule({
      imports: [CommunityTopicModerationControlsComponent],
      providers: [
        { provide: CommunityTopicRepository, useValue: repositoryMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  function createFixture(
    viewerRole: 'owner' | 'admin' | 'moderator' | 'member' | null,
    status: 'active' | 'locked' = 'active'
  ) {
    const fixture = TestBed.createComponent(
      CommunityTopicModerationControlsComponent
    );
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('topicId', 'topic-1');
    fixture.componentRef.setInput('viewerRole', viewerRole);
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it('não oferece moderação para membro comum', () => {
    const fixture = createFixture('member');

    expect(fixture.nativeElement.textContent).not.toContain('Moderação');
    expect(fixture.nativeElement.textContent).not.toContain('Encerrar');
    expect(repositoryMock.moderateTopic$).not.toHaveBeenCalled();
  });

  it('encerra discussão para moderator usando requestId idempotente', () => {
    const fixture = createFixture('moderator');
    const emitted = vi.fn();
    fixture.componentInstance.moderated.subscribe(emitted);

    const button = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>
    ).find((item) => item.textContent?.includes('Encerrar'));
    button?.click();
    fixture.detectChanges();

    expect(repositoryMock.moderateTopic$).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^moderation:/),
      communityId: 'community-1',
      topicId: 'topic-1',
      action: 'lock',
      reason: null,
    });
    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lock', status: 'locked' })
    );
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Discussão encerrada.'
    );
  });

  it('reutiliza requestId quando a mesma moderação é repetida após erro', () => {
    repositoryMock.moderateTopic$
      .mockReturnValueOnce(
        throwError(() => ({ code: 'functions/unavailable' }))
      )
      .mockReturnValueOnce(
        of({
          communityId: 'community-1',
          topicId: 'topic-1',
          action: 'lock',
          status: 'locked',
          moderationState: 'active',
          deduplicated: true,
          generatedAt: Date.now(),
        })
      );

    const fixture = createFixture('admin');
    const component = fixture.componentInstance;

    component.submitStatusAction();
    fixture.detectChanges();
    component.submitStatusAction();
    fixture.detectChanges();

    const firstRequest = repositoryMock.moderateTopic$.mock.calls[0][0];
    const secondRequest = repositoryMock.moderateTopic$.mock.calls[1][0];
    expect(secondRequest.requestId).toBe(firstRequest.requestId);
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'O serviço está temporariamente indisponível. Tente novamente em instantes.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalled();
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Encerramento confirmado.'
    );
  });

  it('reabre uma discussão encerrada', () => {
    repositoryMock.moderateTopic$.mockReturnValue(
      of({
        communityId: 'community-1',
        topicId: 'topic-1',
        action: 'unlock',
        status: 'active',
        moderationState: 'active',
        deduplicated: false,
        generatedAt: Date.now(),
      })
    );
    const fixture = createFixture('owner', 'locked');

    fixture.componentInstance.submitStatusAction();
    fixture.detectChanges();

    expect(repositoryMock.moderateTopic$).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'unlock', reason: null })
    );
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith('Discussão reaberta.');
  });

  it('exige motivo válido antes de remover e envia o texto auditável', () => {
    repositoryMock.moderateTopic$.mockReturnValue(
      of({
        communityId: 'community-1',
        topicId: 'topic-1',
        action: 'remove',
        status: 'archived',
        moderationState: 'removed',
        deduplicated: false,
        generatedAt: Date.now(),
      })
    );
    const fixture = createFixture('moderator');
    const component = fixture.componentInstance;

    component.openRemoveConfirmation();
    component.removeForm.setValue({ reason: '  ' });
    component.submitRemoval();
    expect(repositoryMock.moderateTopic$).not.toHaveBeenCalled();

    component.removeForm.setValue({
      reason: 'Conteúdo incompatível com as regras da Comunidade.',
    });
    component.submitRemoval();
    fixture.detectChanges();

    expect(repositoryMock.moderateTopic$).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^moderation:/),
      communityId: 'community-1',
      topicId: 'topic-1',
      action: 'remove',
      reason: 'Conteúdo incompatível com as regras da Comunidade.',
    });
    expect(component.removeConfirmationOpen()).toBe(false);
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith('Discussão removida.');
  });

  it('traduz reason estruturado sem expor detalhe técnico da moderação', () => {
    repositoryMock.moderateTopic$.mockReturnValue(
      throwError(() => ({
        code: 'functions/failed-precondition',
        message: 'internal transition detail',
        details: { reason: 'removed_topic' },
      }))
    );
    const fixture = createFixture('owner', 'locked');

    fixture.componentInstance.submitStatusAction();
    fixture.detectChanges();

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Uma discussão removida não pode ser reaberta.'
    );
    expect(errorNotifierMock.showError.mock.calls[0]?.[0]).not.toContain(
      'internal transition detail'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });
});
