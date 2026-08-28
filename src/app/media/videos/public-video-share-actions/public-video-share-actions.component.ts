import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PublicVideoShareService } from 'src/app/core/services/media/public-video-share.service';

@Component({
  selector: 'app-public-video-share-actions',
  standalone: true,
  templateUrl: './public-video-share-actions.component.html',
  styleUrls: ['./public-video-share-actions.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicVideoShareActionsComponent {
  readonly video = input.required<IPublicVideoItem>();

  private readonly dialog = inject(MatDialog);
  private readonly publicVideoShare = inject(PublicVideoShareService);
  private readonly errorNotification = inject(ErrorNotificationService);

  readonly menuOpen = signal(false);
  readonly sharingExternally = signal(false);
  readonly openingConversationPicker = signal(false);

  @HostListener('document:click')
  closeMenu(): void {
    this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  closeMenuFromKeyboard(): void {
    this.menuOpen.set(false);
  }

  toggleMenu(event: Event): void {
    event.stopPropagation();

    if (this.sharingExternally() || this.openingConversationPicker()) {
      return;
    }

    this.menuOpen.update((current) => !current);
  }

  async shareExternally(event?: Event): Promise<void> {
    event?.stopPropagation();

    if (this.sharingExternally() || this.openingConversationPicker()) {
      return;
    }

    this.menuOpen.set(false);
    this.sharingExternally.set(true);
    try {
      await this.publicVideoShare.sharePublicVideo(this.video());
    } finally {
      this.sharingExternally.set(false);
    }
  }

  async sendToConversation(event?: Event): Promise<void> {
    event?.stopPropagation();

    if (this.sharingExternally() || this.openingConversationPicker()) {
      return;
    }

    const video = this.video();
    if (!video?.ownerUid || !video?.id) {
      this.errorNotification.showWarning(
        'Este vídeo não pode ser enviado em uma conversa.'
      );
      return;
    }

    this.menuOpen.set(false);
    this.openingConversationPicker.set(true);
    try {
      const { PublicVideoChatShareDialogComponent } = await import(
        '../public-video-chat-share-dialog/public-video-chat-share-dialog.component'
      );

      this.dialog.open(PublicVideoChatShareDialogComponent, {
        data: {
          video: {
            id: video.id,
            ownerUid: video.ownerUid,
            title: video.title,
          },
        },
        autoFocus: false,
        restoreFocus: true,
        width: 'min(92vw, 520px)',
        maxWidth: '100vw',
        maxHeight: '90dvh',
        panelClass: 'public-video-chat-share-dialog',
      });
    } catch {
      this.errorNotification.showError(
        'Não foi possível abrir suas conversas agora.'
      );
    } finally {
      this.openingConversationPicker.set(false);
    }
  }
}
