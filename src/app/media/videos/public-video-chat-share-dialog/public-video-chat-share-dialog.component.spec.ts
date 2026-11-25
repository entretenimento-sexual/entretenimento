import { TestBed } from '@angular/core/testing';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  let sendToChat$: ReturnType<typeof vi.fn>;
  let showSuccess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    allowed$ = new BehaviorSubject(true);
    close = vi.fn();
    sendToChat$ = vi.fn(() => of('message_1'));
    showSuccess = vi.fn();

    TestBed.configureTestingModule({
      imports: [PublicVideoChatShareDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            video: {
              id: 'video_1',
              ownerUid: 'owner_1',
              title: 'Vídeo do perfil',
            },
          },
        },
        { provide: MatDialogRef, useValue: { close } },
        {
          provide: DirectChatFacade,
          useValue: {
            observeCanSendToChat$: () => allowed$,
            state$: of({
              items: [CHAT],
              selectedChatId: null,
              loading: false,
              loaded: true,
              errorMessage: null,
            }),
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
});
