import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { take } from 'rxjs/operators';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PublicVideoChatShareService } from 'src/app/core/services/media/public-video-chat-share.service';
import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectChatListItem } from 'src/app/messaging/direct-chat/models/direct-chat.models';

export interface PublicVideoChatShareDialogData {
  video: Pick<IPublicVideoItem, 'id' | 'ownerUid' | 'title'>;
}

@Component({
  selector: 'app-public-video-chat-share-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  templateUrl: './public-video-chat-share-dialog.component.html',
  styleUrls: ['./public-video-chat-share-dialog.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicVideoChatShareDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<PublicVideoChatShareDialogComponent>
  );
  readonly data = inject<PublicVideoChatShareDialogData>(MAT_DIALOG_DATA);
  private readonly chats = inject(DirectChatFacade);
  private readonly chatShare = inject(PublicVideoChatShareService);
  private readonly errorNotification = inject(ErrorNotificationService);

  readonly state$ = this.chats.state$;
  readonly sendingChatId = signal<string | null>(null);

  close(): void {
    if (!this.sendingChatId()) {
      this.dialogRef.close();
    }
  }

  sendTo(item: DirectChatListItem): void {
    const chatId = String(item?.id ?? '').trim();
    const video = this.data?.video;

    if (
      !chatId ||
      !video?.ownerUid ||
      !video?.id ||
      item.canOpen === false ||
      this.sendingChatId()
    ) {
      return;
    }

    this.sendingChatId.set(chatId);
    this.chatShare.sendToChat$({
      chatId,
      ownerUid: video.ownerUid,
      videoId: video.id,
    })
      .pipe(take(1))
      .subscribe((messageId) => {
        this.sendingChatId.set(null);

        if (!messageId) {
          return;
        }

        this.errorNotification.showSuccess('Vídeo enviado na conversa.');
        this.dialogRef.close({ chatId, messageId });
      });
  }

  displayName(item: DirectChatListItem): string {
    return item.otherParticipantNickname?.trim() || 'Conversa';
  }

  trackByChatId(_index: number, item: DirectChatListItem): string {
    return item.id;
  }
}
