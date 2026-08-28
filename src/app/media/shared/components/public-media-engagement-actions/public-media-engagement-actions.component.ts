import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  switchMap,
  take,
} from 'rxjs/operators';

import {
  IPublicMediaReactionState,
  MediaReactionsService,
} from 'src/app/core/services/media/media-reactions.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

export type TPublicMediaEngagementKind = 'photo' | 'video';

interface PublicMediaEngagementIdentity {
  readonly kind: TPublicMediaEngagementKind;
  readonly ownerUid: string;
  readonly mediaId: string;
  readonly viewerUid: string;
}

@Component({
  selector: 'app-public-media-engagement-actions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-media-engagement-actions.component.html',
  styleUrl: './public-media-engagement-actions.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicMediaEngagementActionsComponent {
  private readonly mediaReactions = inject(MediaReactionsService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly kind = input.required<TPublicMediaEngagementKind>();
  readonly ownerUid = input.required<string>();
  readonly mediaId = input.required<string>();
  readonly viewerUid = input<string | null>(null);

  readonly reactionsEnabled = input(true);
  readonly commentsEnabled = input(true);
  readonly reactionsCount = input(0);
  readonly commentsCount = input(0);

  readonly commentsRequested = output<void>();

  readonly reactionPending = signal(false);
  readonly announcement = signal('');

  private readonly likedOverride = signal<boolean | null>(null);
  private readonly reactionCountOverride = signal<number | null>(null);

  private readonly identity = computed<PublicMediaEngagementIdentity>(() => ({
    kind: this.kind(),
    ownerUid: this.cleanId(this.ownerUid()),
    mediaId: this.cleanId(this.mediaId()),
    viewerUid: this.cleanId(this.viewerUid()),
  }));

  private readonly identityKey = computed(() => {
    const identity = this.identity();
    return [
      identity.kind,
      identity.ownerUid,
      identity.mediaId,
      identity.viewerUid,
    ].join(':');
  });

  private readonly likedFromServer = toSignal(
    toObservable(this.identity).pipe(
      switchMap((identity) => {
        if (!identity.ownerUid || !identity.mediaId || !identity.viewerUid) {
          return of(false);
        }

        return identity.kind === 'photo'
          ? this.mediaReactions.isPhotoLikedByViewer$(
              identity.ownerUid,
              identity.mediaId,
              identity.viewerUid
            )
          : this.mediaReactions.isVideoLikedByViewer$(
              identity.ownerUid,
              identity.mediaId,
              identity.viewerUid
            );
      }),
      catchError(() => of(false)),
      distinctUntilChanged()
    ),
    { initialValue: false }
  );

  readonly liked = computed(() =>
    this.likedOverride() ?? this.likedFromServer()
  );

  readonly reactionCount = computed(() =>
    this.reactionCountOverride() ?? this.normalizeCount(this.reactionsCount())
  );

  readonly commentCount = computed(() =>
    this.normalizeCount(this.commentsCount())
  );

  readonly reactionCountLabel = computed(() =>
    this.reactionCount().toLocaleString('pt-BR')
  );

  readonly commentCountLabel = computed(() =>
    this.commentCount().toLocaleString('pt-BR')
  );

  private readonly resetTransientState = effect(() => {
    this.identityKey();
    this.likedOverride.set(null);
    this.reactionCountOverride.set(null);
    this.announcement.set('');
  });

  private readonly reconcileReactionState = effect(() => {
    const override = this.likedOverride();

    if (override !== null && this.likedFromServer() === override) {
      this.likedOverride.set(null);
    }

    const localCount = this.reactionCountOverride();
    const incomingCount = this.normalizeCount(this.reactionsCount());

    if (localCount !== null && localCount === incomingCount) {
      this.reactionCountOverride.set(null);
    }
  });

  toggleLike(): void {
    if (!this.reactionsEnabled() || this.reactionPending()) {
      return;
    }

    const identity = this.identity();

    if (!identity.viewerUid) {
      this.errorNotification.showWarning('Entre na sua conta para curtir.');
      return;
    }

    if (!identity.ownerUid || !identity.mediaId) {
      this.errorNotification.showWarning('Esta publicação não está disponível.');
      return;
    }

    this.reactionPending.set(true);
    this.announcement.set('');

    const request$ = identity.kind === 'photo'
      ? this.mediaReactions.toggleLikePhotoWithState$(
          identity.ownerUid,
          identity.mediaId,
          identity.viewerUid
        )
      : this.mediaReactions.toggleLikeVideoWithState$(
          identity.ownerUid,
          identity.mediaId,
          identity.viewerUid
        );

    request$
      .pipe(
        take(1),
        finalize(() => this.reactionPending.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((state) => this.applyReactionState(state));
  }

  requestComments(): void {
    if (!this.commentsEnabled()) {
      return;
    }

    this.commentsRequested.emit();
  }

  private applyReactionState(state: IPublicMediaReactionState | null): void {
    if (!state) {
      return;
    }

    this.likedOverride.set(state.liked);
    this.reactionCountOverride.set(this.normalizeCount(state.reactionsCount));
    this.announcement.set(
      state.liked ? 'Curtida adicionada.' : 'Curtida removida.'
    );
  }

  private cleanId(value: string | null | undefined): string {
    const normalized = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
  }

  private normalizeCount(value: unknown): number {
    const count = Number(value ?? 0);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }
}
