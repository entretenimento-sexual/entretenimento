// src/app/chat-module/chat-message/chat-message.component.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';

import { ChatMessageComponent } from './chat-message.component';
import { ChatReplyQuotePipe } from '../pipes/chat-reply-quote.pipe';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';

@Pipe({ name: 'dateFormat', standalone: false })
class DateFormatTestingPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return value;
  }
}

describe('ChatMessageComponent', () => {
  let fixture: ComponentFixture<ChatMessageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ChatMessageComponent, ChatReplyQuotePipe, DateFormatTestingPipe],
      providers: [
        { provide: Firestore, useValue: {} },
        {
          provide: FirestoreUserQueryService,
          useValue: {
            getUser$: vi.fn(() => of({ uid: 'u1', nickname: 'Eu' })),
            getPublicUserById$: vi.fn(() => of({ uid: 'u2', nickname: 'Outro' })),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            log: vi.fn(),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatMessageComponent);
    const comp = fixture.componentInstance;
    comp.currentUserUid = 'u1';
    fixture.componentRef.setInput('message', {
      senderId: 'u1',
      content: 'hi',
      timestamp: { toDate: () => new Date() },
    } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renderiza referência genérica sem expor título ou URL assinada', () => {
    fixture.componentRef.setInput('message', {
      senderId: 'u2',
      nickname: 'Outro',
      content: 'Vídeo compartilhado',
      messageType: 'public_video',
      publicVideoReference: {
        kind: 'PUBLIC_VIDEO',
        ownerUid: 'owner_1',
        videoId: 'video_1',
        title: 'Título legado que não pode ser exibido',
      },
      timestamp: { toDate: () => new Date() },
    } as any);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector(
      '.thread-message__video-reference'
    ) as HTMLAnchorElement | null;

    expect(card).toBeTruthy();
    expect(card?.textContent).toContain('Vídeo compartilhado');
    expect(card?.textContent).toContain('O acesso será verificado ao abrir.');
    expect(card?.textContent).toContain('Abrir vídeo');
    expect(card?.textContent).not.toContain('Título legado');
    expect(fixture.nativeElement.textContent).not.toContain('signed');
    expect(card?.getAttribute('aria-label')).toContain(
      'O acesso será verificado novamente'
    );
    expect(fixture.componentInstance.getAriaLabel()).not.toContain(
      'Título legado'
    );
  });

  it('mantém mensagem textual quando não há referência válida', () => {
    fixture.componentRef.setInput('message', {
      senderId: 'u2',
      nickname: 'Outro',
      content: 'Mensagem normal',
      messageType: 'text',
      timestamp: { toDate: () => new Date() },
    } as any);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.thread-message__video-reference')
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Mensagem normal');
  });
});
