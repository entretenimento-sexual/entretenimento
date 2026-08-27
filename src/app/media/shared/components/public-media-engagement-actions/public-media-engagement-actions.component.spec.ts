import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';
import { PublicMediaEngagementActionsComponent } from './public-media-engagement-actions.component';

describe('PublicMediaEngagementActionsComponent', () => {
  let fixture: ComponentFixture<PublicMediaEngagementActionsComponent>;

  const reactions = {
    isPhotoLikedByViewer$: vi.fn(() => of(false)),
    isVideoLikedByViewer$: vi.fn(() => of(false)),
    toggleLikePhotoWithState$: vi.fn(() =>
      of({ liked: true, reactionsCount: 4, score: 12 })
    ),
    toggleLikeVideoWithState$: vi.fn(() =>
      of({ liked: true, reactionsCount: 4, score: 12 })
    ),
  };

  const notifications = {
    showWarning: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [PublicMediaEngagementActionsComponent],
      providers: [
        { provide: MediaReactionsService, useValue: reactions },
        { provide: ErrorNotificationService, useValue: notifications },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicMediaEngagementActionsComponent);
    fixture.componentRef.setInput('kind', 'photo');
    fixture.componentRef.setInput('ownerUid', 'owner-1');
    fixture.componentRef.setInput('mediaId', 'photo-1');
    fixture.componentRef.setInput('viewerUid', 'viewer-1');
    fixture.componentRef.setInput('reactionsEnabled', true);
    fixture.componentRef.setInput('commentsEnabled', true);
    fixture.componentRef.setInput('reactionsCount', 3);
    fixture.componentRef.setInput('commentsCount', 2);
    fixture.detectChanges();
  });

  it('observa somente o estado de curtida do próprio usuário', () => {
    expect(reactions.isPhotoLikedByViewer$).toHaveBeenCalledWith(
      'owner-1',
      'photo-1',
      'viewer-1'
    );

    const buttons = fixture.debugElement.queryAll(By.css('button'));
    expect(buttons).toHaveLength(2);
    expect(buttons[0].nativeElement.getAttribute('aria-pressed')).toBe('false');
    expect(buttons[0].nativeElement.textContent).toContain('3');
    expect(buttons[1].nativeElement.textContent).toContain('2');
  });

  it('atualiza curtida e contagem com a resposta canônica da Callable', () => {
    const likeButton = fixture.debugElement.queryAll(By.css('button'))[0];

    likeButton.triggerEventHandler('click', null);
    fixture.detectChanges();

    expect(reactions.toggleLikePhotoWithState$).toHaveBeenCalledWith(
      'owner-1',
      'photo-1',
      'viewer-1'
    );
    expect(likeButton.nativeElement.getAttribute('aria-pressed')).toBe('true');
    expect(likeButton.nativeElement.textContent).toContain('4');
    expect(
      fixture.debugElement.query(By.css('[role="status"]')).nativeElement.textContent
    ).toContain('Curtida adicionada');
  });

  it('emite pedido de comentários sem criar formulário paralelo no card', () => {
    const requested = vi.fn();
    fixture.componentInstance.commentsRequested.subscribe(requested);

    fixture.debugElement
      .queryAll(By.css('button'))[1]
      .triggerEventHandler('click', null);

    expect(requested).toHaveBeenCalledTimes(1);
  });

  it('não chama backend de reação sem usuário autenticado', () => {
    fixture.componentRef.setInput('viewerUid', null);
    fixture.detectChanges();

    fixture.debugElement
      .queryAll(By.css('button'))[0]
      .triggerEventHandler('click', null);

    expect(reactions.toggleLikePhotoWithState$).not.toHaveBeenCalled();
    expect(notifications.showWarning).toHaveBeenCalledWith(
      'Entre na sua conta para curtir.'
    );
  });

  it('desabilita ações indisponíveis mantendo contexto acessível', () => {
    fixture.componentRef.setInput('reactionsEnabled', false);
    fixture.componentRef.setInput('commentsEnabled', false);
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(By.css('button'));
    expect(buttons[0].nativeElement.disabled).toBe(true);
    expect(buttons[1].nativeElement.disabled).toBe(true);
    expect(buttons[1].nativeElement.getAttribute('aria-label')).toContain(
      'Comentários desativados'
    );
  });
});
