import { TestBed } from '@angular/core/testing';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PublicVideoChatShareService } from 'src/app/core/services/media/public-video-chat-share.service';
import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectChatListItem } from 'src/app/messaging/direct-chat/models/direct-chat.models';
import { PublicVideoChatShareDialogComponent } from './public-video-chat-share-dialog.component';

const CHAT = {
  id: 'chat_1',
  chat: {} as any,
  otherParticipantUid: 'viewer_2',
  otherParticipantNickname: 'Outro perfil',
  otherParticipantPhotoURL: null,
  unreadCount: 0,
  canOpen: true,
} as DirectChatListItem;

describe('PublicVideoChatShareDialogComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let allowed$: BehaviorSubject<boolean>;
  let uid$: BehaviorSubject<string | null>;
  let state$: BehaviorSubject<any>;
  let observeCanSendToChat$: ReturnType<typeof vi.fn>;
  let sendToChat$: ReturnType<typeof vi.fn>;
  let showSuccess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    allowed$ = new BehaviorSubject(true);
    uid$ = new BehaviorSubject<string | null>('viewer_1');
    state$ = new BehaviorSubject({ items: [CHAT], selectedChatId: null, loading: false, loaded: true, errorMessage: null });
    observeCanSendToChat$ = vi.fn(() => allowed$);
    close = vi.fn();
    sendToChat$ = vi.fn(() => of('message_1'));
    showSuccess = vi.fn();

    TestBed.configureTestingModule({
      imports: [PublicVideoChatShareDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            expectedActorUid: 'viewer_1',
            video: {
              id: 'video_1',
              ownerUid: 'owner_1',
              title: 'Vídeo do perfil',
            },
          },
        },
        { provide: MatDialogRef, useValue: { close } },
        { provide: AuthSessionService, useValue: { uid$ } },
        {
          provide: DirectChatFacade,
          useValue: {
            observeCanSendToChat$,
            state$,
          },
        },
        {
          provide: PublicVideoChatShareService,
          useValue: { sendToChat$ },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showSuccess },
        },
      ],
    });
  });

  it('envia somente a identidade segura do vídeo para a conversa', () => {
    const fixture = TestBed.createComponent(
      PublicVideoChatShareDialogComponent
    );
    fixture.detectChanges();

    fixture.componentInstance.sendTo(CHAT);

    expect(sendToChat$).toHaveBeenCalledWith({
      chatId: 'chat_1',
      expectedActorUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
    });
    expect(showSuccess).toHaveBeenCalledWith(
      'Vídeo enviado na conversa.'
    );
    expect(close).toHaveBeenCalledWith({
      chatId: 'chat_1',
      messageId: 'message_1',
    });
    expect(fixture.componentInstance.sendingChatId()).toBeNull();
  });

  it('não envia para conversa indisponível', () => {
    const fixture = TestBed.createComponent(
      PublicVideoChatShareDialogComponent
    );
    fixture.detectChanges();

    fixture.componentInstance.sendTo({ ...CHAT, canOpen: false });

    expect(sendToChat$).not.toHaveBeenCalled();
  });

  it('preserva histórico sem permitir compartilhar quando a projeção bilateral é revogada', () => {
    const fixture = TestBed.createComponent(PublicVideoChatShareDialogComponent);
    fixture.detectChanges();
    allowed$.next(false);
    expect(fixture.componentInstance.canSendTo(CHAT)).toBe(false);
    fixture.componentInstance.sendTo(CHAT);
    expect(sendToChat$).not.toHaveBeenCalled();
    allowed$.next(true);
    const pending = new Subject<string>();
    sendToChat$.mockReturnValue(pending);
    fixture.componentInstance.sendTo(CHAT);
    allowed$.next(false);
    pending.next('late-message');
    expect(close).not.toHaveBeenCalled();
    expect(showSuccess).not.toHaveBeenCalled();
    expect(fixture.componentInstance.sendingChatId()).toBeNull();
  });

  it('não reinicia o par nem cancela envio quando outra conversa entra ou sai', () => {
    const other = { ...CHAT, id: 'chat_2', otherParticipantUid: 'viewer_3' };
    const otherAllowed$ = new BehaviorSubject(true);
    observeCanSendToChat$.mockImplementation((id: string) =>
      id === CHAT.id ? allowed$ : otherAllowed$);
    const fixture = TestBed.createComponent(PublicVideoChatShareDialogComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const pending = new Subject<string>();
    sendToChat$.mockReturnValue(pending);
    component.sendTo(CHAT);
    state$.next({ ...state$.value, items: [CHAT, other] });
    expect(component.canSendTo(CHAT)).toBe(true);
    expect(component.sendingChatId()).toBe(CHAT.id);
    state$.next({ ...state$.value, items: [CHAT] });
    expect(component.sendingChatId()).toBe(CHAT.id);
    expect(otherAllowed$.observers.length).toBe(0);
    expect(observeCanSendToChat$.mock.calls.filter(([id]) => id === CHAT.id)).toHaveLength(1);
    pending.next('message_1');
    expect(close).toHaveBeenCalledWith({ chatId: CHAT.id, messageId: 'message_1' });
  });

  it('revoga o contexto antigo quando o mesmo ID recebe outro participante', () => {
    const fixture = TestBed.createComponent(PublicVideoChatShareDialogComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const pending = new Subject<string>();
    sendToChat$.mockReturnValue(pending);
    component.sendTo(CHAT);
    const changed = { ...CHAT, otherParticipantUid: 'viewer_3' };
    state$.next({ ...state$.value, items: [changed] });
    expect(component.canSendTo(CHAT)).toBe(false);
    expect(component.sendingChatId()).toBeNull();
    pending.next('late-message');
    expect(close).not.toHaveBeenCalled();
    expect(showSuccess).not.toHaveBeenCalled();
    component.sendTo(CHAT);
    expect(sendToChat$).toHaveBeenCalledTimes(1);
  });

  it('limpa o seletor e cancela o envio após trocar de conta, sem rearmar na mesma conta', () => {
    const fixture = TestBed.createComponent(PublicVideoChatShareDialogComponent);
    fixture.detectChanges();
    const pending = new Subject<string>();
    sendToChat$.mockReturnValue(pending);
    fixture.componentInstance.sendTo(CHAT);
    expect(fixture.componentInstance.sendingChatId()).toBe('chat_1');
    const calls = observeCanSendToChat$.mock.calls.length;

    uid$.next(null);
    expect(fixture.componentInstance.sendingChatId()).toBeNull();
    uid$.next('viewer_2');
    state$.next({ ...state$.value, items: [{ ...CHAT, id: 'chat_2' }] });
    uid$.next('viewer_1');
    state$.next({ ...state$.value, items: [CHAT] });
    pending.next('late-message');
    fixture.detectChanges();
    expect(fixture.componentInstance.canSendTo(CHAT)).toBe(false);
    expect(observeCanSendToChat$.mock.calls.length).toBe(calls);
    expect(fixture.nativeElement.textContent).toContain('Compartilhamento encerrado');
    expect(fixture.nativeElement.textContent).not.toContain('Outro perfil');
    fixture.componentInstance.sendTo(CHAT);
    expect(sendToChat$).toHaveBeenCalledTimes(1);
    expect(showSuccess).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('não consulta conversas se o seletor abrir em outra conta', () => {
    uid$.next('viewer_2');
    const fixture = TestBed.createComponent(PublicVideoChatShareDialogComponent);
    fixture.detectChanges();
    expect(observeCanSendToChat$).not.toHaveBeenCalled();
    expect(fixture.componentInstance.canSendTo(CHAT)).toBe(false);
    fixture.componentInstance.sendTo(CHAT);
    expect(sendToChat$).not.toHaveBeenCalled();
  });
});
