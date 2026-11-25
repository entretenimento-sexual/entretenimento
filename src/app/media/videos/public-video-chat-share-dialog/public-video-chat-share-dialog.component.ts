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
import { Observable, Subscription, of } from 'rxjs';
import { distinctUntilChanged, filter, finalize, map, shareReplay, startWith, switchMap, take, takeUntil, takeWhile } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PublicVideoChatShareService } from 'src/app/core/services/media/public-video-chat-share.service';
import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { DirectChatListItem, DirectChatListState } from 'src/app/messaging/direct-chat/models/direct-chat.models';

export interface PublicVideoChatShareDialogData {
  expectedActorUid: string;
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
  private readonly authSession = inject(AuthSessionService);
  // A picker is a single-session intent. Once the original UID disappears,
  // even a new login with the same UID must open a new picker.
  private readonly expectedActorUid = String(this.data?.expectedActorUid ?? '').trim();
  private readonly sessionOwner$ = this.authSession.uid$.pipe(
    takeWhile(uid => !!uid && uid === this.expectedActorUid, true),
    map(uid => uid && uid === this.expectedActorUid ? uid : null),
    distinctUntilChanged(),
    takeUntilDestroyed(this.destroyRef),
    shareReplay({ bufferSize: 1, refCount: false })
  );
  readonly sessionOwner = toSignal(this.sessionOwner$, { initialValue: null });
  readonly state$ = this.sessionOwner$.pipe(
    switchMap(uid => uid ? this.chats.state$ : of<DirectChatListState>({
      items: [], selectedChatId: null, loading: false, loaded: true, errorMessage: null,
    })),
    shareReplay({ bufferSize: 1, refCount: true })
  );
  // Keep each canonical conversation observation independent. Changes to
  // another row (including removal) must not interrupt an authorized send.
  private readonly sendAccess$ = new Observable<ReadonlyMap<string, boolean>>(subscriber => {
    const subscriptions = new Subscription();
    subscriber.add(subscriptions);
    const active = new Map<string, Subscription>();
    const values = new Map<string, boolean>();
    const publish = () => subscriber.next(new Map(values));

    subscriptions.add(this.state$.pipe(
      map(state => state.items.filter(item => item.canOpen === true)
        .map(item => ({ key: this.sendAccessKey(item), id: item.id }))
        .filter(target => target.key !== null)),
      distinctUntilChanged((a, b) => a.length === b.length &&
        a.every(target => b.some(other => other.key === target.key)))
    ).subscribe({
      next: targets => {
        const requested = new Map(targets.map(target => [target.key!, target.id]));
        for (const [key, subscription] of active) {
          if (requested.has(key)) continue;
          active.delete(key);
          values.delete(key);
          subscription.unsubscribe();
        }

        // Publish removals and new pending rows atomically before subscribing.
        const additions: Array<{ key: string; id: string; subscription: Subscription }> = [];
        for (const [key, id] of requested) {
          if (active.has(key)) continue;
          const subscription = new Subscription();
          subscriptions.add(subscription);
          active.set(key, subscription);
          values.set(key, false);
          additions.push({ key, id, subscription });
        }
        publish();

        for (const { key, id, subscription } of additions) {
          if (subscription.closed || subscriber.closed) continue;
          subscription.add(this.chats.observeCanSendToChat$(id).pipe(
            startWith(false), distinctUntilChanged()
          ).subscribe({
            next: allowed => {
              if (active.get(key) !== subscription || values.get(key) === allowed) return;
              values.set(key, allowed === true);
              publish();
            },
            error: error => subscriber.error(error),
          }));
        }
      },
      error: error => subscriber.error(error),
    }));
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  private readonly sendAccess = toSignal(this.sendAccess$, { initialValue: new Map<string, boolean>() });

  private sendAccessKey(item: DirectChatListItem): string | null {
    const id = String(item.id ?? '').trim();
    const peer = String(item.otherParticipantUid ?? '').trim();
    return id && peer ? JSON.stringify([id, peer]) : null;
  }

  canSendTo(item: DirectChatListItem): boolean {
    const key = this.sendAccessKey(item);
    return !!this.sessionOwner() && item.canOpen === true && key !== null &&
      this.sendAccess().get(key) === true;
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
    const expectedActorUid = this.sessionOwner();
    const accessKey = this.sendAccessKey(item);

    if (
      !expectedActorUid ||
      !chatId ||
      !accessKey ||
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
      expectedActorUid,
      ownerUid: video.ownerUid,
      videoId: video.id,
    })
      .pipe(
        take(1),
        takeUntil(this.sessionOwner$.pipe(filter(uid => uid !== expectedActorUid))),
        takeUntil(this.sendAccess$.pipe(filter(access => access.get(accessKey) !== true))),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.sendingChatId.set(null))
      )
      .subscribe((messageId) => {

        if (!messageId || this.sessionOwner() !== expectedActorUid || !this.canSendTo(item)) {
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
