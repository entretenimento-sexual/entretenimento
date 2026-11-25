import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { combineLatest, of } from 'rxjs';
import { distinctUntilChanged, filter, finalize, map, shareReplay, startWith, switchMap, take, takeUntil } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PublicVideoChatShareService } from 'src/app/core/services/media/public-video-chat-share.service';
import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectChatListItem } from 'src/app/messaging/direct-chat/models/direct-chat.models';

export interface PublicVideoChatShareDialogData {
  video: Pick<IPublicVideoItem, 'id' | 'ownerUid' | 'title'>;
}
import { ProfileAvatarDirective } from 'src/app/shared/directives/profile-avatar.directive';

@Component({
  selector: 'app-public-video-chat-share-dialog',
  standalone: true,
  imports: [ProfileAvatarDirective,CommonModule, MatDialogModule],
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

  private readonly destroyRef = inject(DestroyRef);
  readonly state$ = this.chats.state$;
  // Preview/unread changes must not restart pair listeners. Unknown denies send.
  private readonly sendAccess$ = this.state$.pipe(
    map(state => state.items.filter(item => item.canOpen === true)
      .map(item => item.id).sort()),
    distinctUntilChanged((a, b) => a.length === b.length && a.every((id, i) => id === b[i])),
    switchMap(ids => ids.length
      ? combineLatest(ids.map(id => this.chats.observeCanSendToChat$(id).pipe(
          startWith(false), map(allowed => [id, allowed] as const)
        ))).pipe(map(entries => new Map(entries)))
      : of(new Map<string, boolean>())),
    shareReplay({ bufferSize: 1, refCount: true })
  );
  private readonly sendAccess = toSignal(this.sendAccess$, { initialValue: new Map<string, boolean>() });

  canSendTo(item: DirectChatListItem): boolean {
    return item.canOpen === true && this.sendAccess().get(item.id) === true;
  }
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
      !this.canSendTo(item) ||
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
      .pipe(
        take(1),
        takeUntil(this.sendAccess$.pipe(filter(access => access.get(chatId) !== true))),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.sendingChatId.set(null))
      )
      .subscribe((messageId) => {

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
