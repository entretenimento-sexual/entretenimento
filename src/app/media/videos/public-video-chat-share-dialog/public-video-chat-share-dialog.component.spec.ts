import { TestBed } from '@angular/core/testing';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { of } from 'rxjs';
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
  let sendToChat$: ReturnType<typeof vi.fn>;
  let showSuccess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
});
