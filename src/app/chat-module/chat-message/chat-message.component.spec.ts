// src/app/chat-module/chat-message/chat-message.component.spec.ts
vi.mock('firebase/firestore', { spy: true });

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { BehaviorSubject, of } from 'rxjs';
import { deleteField, doc, FieldPath, updateDoc } from 'firebase/firestore';


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
  const uid$ = new BehaviorSubject<string | null>('u1');
  let fixture: ComponentFixture<ChatMessageComponent>;

  beforeEach(async () => {
    uid$.next('u1');
    vi.mocked(doc).mockReturnValue({ path: 'chats/chat-1/messages/msg-1' } as any);
    vi.mocked(updateDoc).mockReset();
    vi.mocked(updateDoc).mockResolvedValue(undefined);
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
            uid$: uid$.asObservable(),
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

  it('limpa reação do usuário anterior após troca de UID', () => {
    fixture.componentRef.setInput('message', {
      id: 'msg-1',
      senderId: 'u2',
      content: 'Mensagem',
      reactionsByUser: { u1: '❤️', u2: '🔥' },
    } as any);
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedReaction).toBe('❤️');
    uid$.next(null);
    expect(fixture.componentInstance.selectedReaction).toBeNull();
    uid$.next('u2');
    expect(fixture.componentInstance.selectedReaction).toBe('🔥');
  });

  it('não grava reação direta sem sessão autenticada', () => {
    uid$.next(null);
    fixture.componentRef.setInput('message', {
      id: 'msg-1',
      senderId: 'u2',
      content: 'Mensagem',
      reactionsByUser: {},
    } as any);
    fixture.detectChanges();
    fixture.componentInstance.selectQuickReaction('❤️');
    expect(fixture.componentInstance.selectedReaction).toBeNull();
    expect(fixture.componentInstance.isSavingReaction).toBe(false);
  });

  it('grava apenas a reação do UID atual sem substituir o mapa dos demais', async () => {
    fixture.componentRef.setInput('chatId', 'chat-1');
    fixture.componentRef.setInput('message', {
      id: 'msg-1',
      senderId: 'u2',
      content: 'Mensagem',
      reactionsByUser: { u2: '🔥' },
    } as any);
    fixture.detectChanges();

    fixture.componentInstance.selectQuickReaction('❤️');
    await Promise.resolve();

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const args = vi.mocked(updateDoc).mock.calls[0];
    expect(args[1]).toBeInstanceOf(FieldPath);
    expect(args[1]).toEqual(new FieldPath('reactionsByUser', 'u1'));
    expect(args[2]).toBe('❤️');
    expect(args).toHaveLength(3);
  });

  it('usa deleteField para remover somente a reação do UID atual', async () => {
    fixture.componentRef.setInput('chatId', 'chat-1');
    fixture.componentRef.setInput('message', {
      id: 'msg-1',
      senderId: 'u2',
      content: 'Mensagem',
      reactionsByUser: { u1: '❤️', u2: '🔥' },
    } as any);
    fixture.detectChanges();

    fixture.componentInstance.selectQuickReaction('❤️');
    await Promise.resolve();

    const args = vi.mocked(updateDoc).mock.calls[0];
    expect(args[1]).toBeInstanceOf(FieldPath);
    expect(args[1]).toEqual(new FieldPath('reactionsByUser', 'u1'));
    expect(args[2]).toEqual(deleteField());
    expect(args).toHaveLength(3);
  });

  it('descarta resposta de erro pendente após troca de UID', async () => {
    let rejectWrite!: (reason: unknown) => void;
    vi.mocked(updateDoc).mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectWrite = reject; })
    );
    fixture.componentRef.setInput('chatId', 'chat-1');
    fixture.componentRef.setInput('message', {
      id: 'msg-1',
      senderId: 'u2',
      content: 'Mensagem',
      reactionsByUser: {},
    } as any);
    fixture.detectChanges();

    fixture.componentInstance.selectQuickReaction('❤️');
    uid$.next('u2');
    rejectWrite(new Error('late permission denied'));
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.componentInstance.selectedReaction).toBeNull();
    expect(fixture.componentInstance.isSavingReaction).toBe(false);
  });

  it('descarta erro de reação da mensagem anterior quando o balão muda de mensagem', async () => {
    let rejectWrite!: (reason: unknown) => void;
    vi.mocked(updateDoc).mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectWrite = reject; })
    );
    fixture.componentRef.setInput('chatId', 'chat-1');
    fixture.componentRef.setInput('message', {
      id: 'msg-1', senderId: 'u2', content: 'Mensagem A', reactionsByUser: {},
    } as any);
    fixture.detectChanges();

    fixture.componentInstance.selectQuickReaction('❤️');
    fixture.componentRef.setInput('message', {
      id: 'msg-2', senderId: 'u2', content: 'Mensagem B',
      reactionsByUser: { u1: '🔥' },
    } as any);
    fixture.detectChanges();
    rejectWrite(new Error('late permission denied'));
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.componentInstance.selectedReaction).toBe('🔥');
    expect(fixture.componentInstance.isSavingReaction).toBe(false);
  });

  it('renderiza referência de vídeo sem expor URL assinada', () => {
    fixture.componentRef.setInput('message', {
      senderId: 'u2',
      nickname: 'Outro',
      content: 'Vídeo compartilhado',
      messageType: 'public_video',
      publicVideoReference: {
        kind: 'PUBLIC_VIDEO',
        ownerUid: 'owner_1',
        videoId: 'video_1',
        title: 'Apresentação do perfil',
      },
      timestamp: { toDate: () => new Date() },
    } as any);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector(
      '.thread-message__video-reference'
    ) as HTMLAnchorElement | null;

    expect(card).toBeTruthy();
    expect(card?.textContent).toContain('Apresentação do perfil');
    expect(card?.textContent).toContain('Abrir vídeo');
    expect(fixture.nativeElement.textContent).not.toContain('signed');
    expect(fixture.componentInstance.getAriaLabel()).toContain(
      'Vídeo compartilhado: Apresentação do perfil'
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
