import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  combineLatest,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { IVideoComment } from 'src/app/core/interfaces/media/i-video-comment';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';
import { MediaVideoCommentsService } from 'src/app/core/services/media/media-video-comments.service';
import {
  MediaVideoRatingsService,
  VideoRatingSummary,
} from 'src/app/core/services/media/media-video-ratings.service';
import {
  TVideoViewSource,
  VideoViewTrackingService,
} from 'src/app/core/services/media/video-view-tracking.service';

export interface IPublicVideoViewerData {
  ownerUid: string;
  items: IPublicVideoItem[];
  startIndex: number;
  source?: TVideoViewSource;
}

interface ViewerUserLike {
  uid?: string | null;
}

interface VideoCommentThread {
  root: IVideoComment;
  replies: IVideoComment[];
}

@Component({
  selector: 'app-public-video-viewer',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    MatDialogModule,
  ],
  templateUrl: './public-video-viewer.component.html',
  styleUrls: ['./public-video-viewer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicVideoViewerComponent {
  private readonly dialogRef = inject(
    MatDialogRef<PublicVideoViewerComponent>
  );
  readonly data = inject<IPublicVideoViewerData>(MAT_DIALOG_DATA);

  private readonly videoViewTracking = inject(VideoViewTrackingService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly reactions = inject(MediaReactionsService);
  private readonly comments = inject(MediaVideoCommentsService);
  private readonly ratings = inject(MediaVideoRatingsService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly recordedViewKeys = new Set<string>();

  @ViewChild('videoPlayer')
  private videoPlayer?: ElementRef<HTMLVideoElement>;

  index: number;
  readonly ratingOptions = [1, 2, 3, 4, 5] as const;
  readonly commentsExpanded = signal(false);
  readonly ratingsExpanded = signal(false);
  readonly commentControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(500)],
  });
  readonly replyControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(500)],
  });

  private readonly currentVideoIdSubject = new BehaviorSubject<string>('');
  readonly currentVideoId$ = this.currentVideoIdSubject.pipe(
    distinctUntilChanged()
  );

  private readonly togglingLikeSubject = new BehaviorSubject(false);
  readonly togglingLike$ = this.togglingLikeSubject.asObservable();

  private readonly submittingRatingSubject = new BehaviorSubject(false);
  readonly submittingRating$ = this.submittingRatingSubject.asObservable();

  private readonly submittingCommentSubject = new BehaviorSubject(false);
  readonly submittingComment$ = this.submittingCommentSubject.asObservable();

  private readonly submittingReplySubject = new BehaviorSubject(false);
  readonly submittingReply$ = this.submittingReplySubject.asObservable();

  private readonly replyingToCommentIdSubject =
    new BehaviorSubject<string | null>(null);
  readonly replyingToCommentId$ = this.replyingToCommentIdSubject.pipe(
    distinctUntilChanged()
  );

  private readonly moderatingCommentIdSubject =
    new BehaviorSubject<string | null>(null);
  readonly moderatingCommentId$ = this.moderatingCommentIdSubject.pipe(
    distinctUntilChanged()
  );

  readonly viewerUid$: Observable<string | null> =
    this.currentUserStore.user$.pipe(
      map((user) => (user as ViewerUserLike | null)?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly viewerIsOwner$ = this.viewerUid$.pipe(
    map((uid) => !!uid && uid === this.data.ownerUid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentVideo$ = this.currentVideoId$.pipe(
    map(() => this.current),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canReact$ = this.currentVideo$.pipe(
    map((video) =>
      video?.moderationStatus === 'APPROVED' &&
      video.reactionsEnabled === true
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canComment$ = this.currentVideo$.pipe(
    map((video) =>
      video?.moderationStatus === 'APPROVED' &&
      video.commentsEnabled === true
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly canRate$ = this.currentVideo$.pipe(
    map((video) =>
      video?.moderationStatus === 'APPROVED' &&
      video.ratingsEnabled === true
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly likesCount$ = this.currentVideoId$.pipe(
    switchMap((videoId) => videoId
      ? this.reactions.getVideoLikesCount$(this.data.ownerUid, videoId)
      : of(0)),
    catchError(() => of(0)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly likedByViewer$ = this.currentVideoId$.pipe(
    switchMap((videoId) => videoId
      ? this.viewerUid$.pipe(
          switchMap((viewerUid) =>
            this.reactions.isVideoLikedByViewer$(
              this.data.ownerUid,
              videoId,
              viewerUid
            )
          )
        )
      : of(false)),
    catchError(() => of(false)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly ratingSummary$ = this.currentVideoId$.pipe(
    switchMap((videoId) => videoId
      ? this.ratings.watchSummary$(this.data.ownerUid, videoId)
      : of(this.emptyRatingSummary())),
    catchError(() => of(this.emptyRatingSummary())),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewerRating$ = this.currentVideoId$.pipe(
    switchMap((videoId) => videoId
      ? this.viewerUid$.pipe(
          switchMap((viewerUid) =>
            this.ratings.watchViewerRating$(
              this.data.ownerUid,
              videoId,
              viewerUid
            )
          )
        )
      : of(null)),
    catchError(() => of(null)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly comments$ = this.currentVideoId$.pipe(
    switchMap((videoId) => videoId
      ? this.comments.watchVisibleComments$(this.data.ownerUid, videoId)
      : of([] as IVideoComment[])),
    catchError(() => of([] as IVideoComment[])),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly commentThreads$ = this.comments$.pipe(
    map((items) => this.buildCommentThreads(items)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly commentsCount$ = this.commentThreads$.pipe(
    map((threads) => threads.length),
    distinctUntilChanged()
  );

  readonly commentLength$ = this.commentControl.valueChanges.pipe(
    startWith(this.commentControl.value),
    map((value) => value.trim().length),
    distinctUntilChanged()
  );

  readonly replyLength$ = this.replyControl.valueChanges.pipe(
    startWith(this.replyControl.value),
    map((value) => value.trim().length),
    distinctUntilChanged()
  );

  constructor() {
    const itemsCount = this.data.items?.length ?? 0;
    this.index = itemsCount > 0
      ? Math.max(0, Math.min(this.data.startIndex ?? 0, itemsCount - 1))
      : 0;
    this.syncCurrentVideoId();
    this.recordCurrentVideoView();
  }

  get current(): IPublicVideoItem | null {
    return this.data.items?.[this.index] ?? null;
  }

  get hasPrevious(): boolean {
    return this.index > 0;
  }

  get hasNext(): boolean {
    return this.index < (this.data.items?.length ?? 0) - 1;
  }

  get positionLabel(): string {
    const total = this.data.items?.length ?? 0;
    return total > 0 ? `${this.index + 1} de ${total}` : 'Sem vídeos';
  }

  @HostListener('document:keydown.arrowleft', ['$event'])
  onArrowLeft(event: Event): void {
    if (this.isTypingTarget(event.target)) {
      return;
    }
    event.preventDefault();
    this.previous();
  }

  @HostListener('document:keydown.arrowright', ['$event'])
  onArrowRight(event: Event): void {
    if (this.isTypingTarget(event.target)) {
      return;
    }
    event.preventDefault();
    this.next();
  }

  close(): void {
    this.pauseCurrentVideo();
    this.dialogRef.close();
  }

  previous(): void {
    if (this.hasPrevious) {
      this.changeIndex(this.index - 1);
    }
  }

  next(): void {
    if (this.hasNext) {
      this.changeIndex(this.index + 1);
    }
  }

  toggleComments(): void {
    if (this.current?.commentsEnabled !== true) {
      this.errorNotification.showWarning(
        'Comentários desativados neste vídeo.'
      );
      return;
    }
    this.commentsExpanded.update((value) => !value);
  }

  toggleRatings(): void {
    if (this.current?.ratingsEnabled !== true) {
      this.errorNotification.showWarning(
        'Avaliações desativadas neste vídeo.'
      );
      return;
    }
    this.ratingsExpanded.update((value) => !value);
  }

  toggleLike(): void {
    const video = this.current;

    if (!video?.id || this.togglingLikeSubject.value) {
      return;
    }

    this.togglingLikeSubject.next(true);
    combineLatest([this.viewerUid$, this.viewerIsOwner$, this.canReact$])
      .pipe(
        take(1),
        switchMap(([viewerUid, viewerIsOwner, canReact]) => {
          if (!viewerUid) {
            this.errorNotification.showWarning('Entre na sua conta para curtir.');
            return EMPTY;
          }
          if (viewerIsOwner) {
            this.errorNotification.showWarning(
              'Você não pode curtir o próprio vídeo.'
            );
            return EMPTY;
          }
          if (!canReact) {
            this.errorNotification.showWarning(
              'Curtidas indisponíveis neste vídeo.'
            );
            return EMPTY;
          }
          return this.reactions.toggleLikeVideo$(
            this.data.ownerUid,
            video.id,
            viewerUid
          );
        }),
        finalize(() => this.togglingLikeSubject.next(false))
      )
      .subscribe();
  }

  rateVideo(rating: number): void {
    const video = this.current;

    if (!video?.id || this.submittingRatingSubject.value) {
      return;
    }

    this.submittingRatingSubject.next(true);
    combineLatest([this.viewerUid$, this.viewerIsOwner$, this.canRate$])
      .pipe(
        take(1),
        switchMap(([viewerUid, viewerIsOwner, canRate]) => {
          if (!viewerUid) {
            this.errorNotification.showWarning(
              'Entre na sua conta para avaliar.'
            );
            return EMPTY;
          }
          if (viewerIsOwner) {
            this.errorNotification.showWarning(
              'Você não pode avaliar o próprio vídeo.'
            );
            return EMPTY;
          }
          if (!canRate) {
            this.errorNotification.showWarning(
              'Avaliações indisponíveis neste vídeo.'
            );
            return EMPTY;
          }
          return this.ratings.rateVideo$(
            this.data.ownerUid,
            video.id,
            viewerUid,
            rating
          );
        }),
        finalize(() => this.submittingRatingSubject.next(false))
      )
      .subscribe();
  }

  submitComment(event?: Event): void {
    event?.preventDefault();
    const video = this.current;
    const content = this.cleanComment(this.commentControl.value);

    if (!video?.id || !content || this.submittingCommentSubject.value) {
      return;
    }

    this.submittingCommentSubject.next(true);
    combineLatest([this.viewerUid$, this.canComment$])
      .pipe(
        take(1),
        switchMap(([viewerUid, canComment]) => {
          if (!viewerUid) {
            this.errorNotification.showWarning(
              'Entre na sua conta para comentar.'
            );
            return of(null);
          }
          if (!canComment) {
            this.errorNotification.showWarning(
              'Comentários indisponíveis neste vídeo.'
            );
            return of(null);
          }
          return this.comments.createComment$({
            ownerUid: this.data.ownerUid,
            videoId: video.id,
            content,
          });
        }),
        finalize(() => this.submittingCommentSubject.next(false))
      )
      .subscribe((commentId) => {
        if (commentId) {
          this.commentControl.setValue('');
        }
      });
  }

  startReply(comment: IVideoComment): void {
    if (!comment.id || comment.parentCommentId) {
      return;
    }
    this.replyControl.setValue('');
    this.replyingToCommentIdSubject.next(comment.id);
  }

  cancelReply(): void {
    this.replyControl.setValue('');
    this.replyingToCommentIdSubject.next(null);
  }

  submitReply(comment: IVideoComment, event?: Event): void {
    event?.preventDefault();
    const video = this.current;
    const content = this.cleanComment(this.replyControl.value);

    if (!video?.id || !comment.id || !content) {
      return;
    }

    this.submittingReplySubject.next(true);
    combineLatest([this.viewerIsOwner$, this.canComment$])
      .pipe(
        take(1),
        switchMap(([viewerIsOwner, canComment]) => {
          if (!viewerIsOwner || !canComment) {
            return of(null);
          }
          return this.comments.replyToComment$({
            ownerUid: this.data.ownerUid,
            videoId: video.id,
            parentCommentId: comment.id,
            content,
          });
        }),
        finalize(() => this.submittingReplySubject.next(false))
      )
      .subscribe((replyId) => {
        if (replyId) {
          this.cancelReply();
        }
      });
  }

  hideComment(comment: IVideoComment): void {
    this.moderateComment(comment, 'HIDE');
  }

  deleteComment(comment: IVideoComment): void {
    this.moderateComment(comment, 'DELETE');
  }

  canDeleteComment(
    comment: IVideoComment,
    viewerUid: string | null,
    viewerIsOwner: boolean | null
  ): boolean {
    return !!viewerIsOwner || (!!viewerUid && viewerUid === comment.authorUid);
  }

  formatDuration(durationMs: number | null | undefined): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(Number(durationMs ?? 0) / 1000)
    );

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return 'Duração não informada';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [hours, minutes, seconds]
        .map((value, index) => index === 0
          ? String(value)
          : String(value).padStart(2, '0'))
        .join(':');
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  formatCommentDate(value: number | null | undefined): string {
    const timestamp = Number(value ?? 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return '';
    }
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp);
  }

  ratingSummaryLabel(summary: VideoRatingSummary | null): string {
    const count = summary?.ratingsCount ?? 0;

    if (count <= 0) {
      return 'Avaliar';
    }

    const average = this.formatRatingAverage(summary?.ratingAverage);
    return `Avaliação · ${average} (${count})`;
  }

  private formatRatingAverage(value: number | null | undefined): string {
    const average = Number(value ?? 0);

    if (!Number.isFinite(average) || average <= 0) {
      return '0';
    }

    return average.toLocaleString('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    });
  }

  private moderateComment(
    comment: IVideoComment,
    action: 'HIDE' | 'DELETE'
  ): void {
    const video = this.current;

    if (!video?.id || !comment.id) {
      return;
    }

    this.moderatingCommentIdSubject.next(comment.id);
    combineLatest([this.viewerUid$, this.viewerIsOwner$])
      .pipe(
        take(1),
        switchMap(([viewerUid, viewerIsOwner]) => {
          if (action === 'HIDE') {
            return viewerIsOwner
              ? this.comments.hideComment$(
                  this.data.ownerUid,
                  video.id,
                  comment.id
                )
              : of(null);
          }
          return this.canDeleteComment(comment, viewerUid, viewerIsOwner)
            ? this.comments.deleteComment$(
                this.data.ownerUid,
                video.id,
                comment.id
              )
            : of(null);
        }),
        finalize(() => this.moderatingCommentIdSubject.next(null))
      )
      .subscribe();
  }

  private changeIndex(nextIndex: number): void {
    this.pauseCurrentVideo();
    this.index = nextIndex;
    this.commentsExpanded.set(false);
    this.ratingsExpanded.set(false);
    this.commentControl.setValue('');
    this.cancelReply();
    this.syncCurrentVideoId();
    this.recordCurrentVideoView();

    queueMicrotask(() => {
      this.videoPlayer?.nativeElement.load();
      this.videoPlayer?.nativeElement.focus({ preventScroll: true });
    });
  }

  private syncCurrentVideoId(): void {
    this.currentVideoIdSubject.next(this.current?.id ?? '');
  }

  private recordCurrentVideoView(): void {
    const video = this.current;
    const ownerUid = (video?.ownerUid ?? this.data.ownerUid ?? '').trim();
    const videoId = (video?.id ?? '').trim();
    const viewKey = `${ownerUid}:${videoId}`;

    if (!ownerUid || !videoId || this.recordedViewKeys.has(viewKey)) {
      return;
    }

    combineLatest([this.viewerUid$, this.viewerIsOwner$])
      .pipe(
        take(1),
        switchMap(([viewerUid, viewerIsOwner]) => {
          if (!viewerUid || viewerIsOwner) {
            return EMPTY;
          }
          this.recordedViewKeys.add(viewKey);
          return this.videoViewTracking.recordVideoView$(
            ownerUid,
            videoId,
            this.data.source ?? 'unknown'
          );
        }),
        catchError(() => EMPTY)
      )
      .subscribe();
  }

  private buildCommentThreads(items: IVideoComment[]): VideoCommentThread[] {
    const roots = items.filter((comment) => !comment.parentCommentId);
    const replies = new Map<string, IVideoComment[]>();

    for (const comment of items) {
      if (!comment.parentCommentId) {
        continue;
      }
      const current = replies.get(comment.parentCommentId) ?? [];
      current.push(comment);
      replies.set(comment.parentCommentId, current);
    }

    return roots.map((root) => ({
      root,
      replies: root.id ? replies.get(root.id) ?? [] : [],
    }));
  }

  private cleanComment(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  private emptyRatingSummary(): VideoRatingSummary {
    return { ratingsCount: 0, ratingAverage: 0 };
  }

  private pauseCurrentVideo(): void {
    try {
      this.videoPlayer?.nativeElement.pause();
    } catch {
      // noop
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT';
  }
}
