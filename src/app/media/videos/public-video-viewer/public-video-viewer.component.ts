import { CommonModule } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  pairwise,
  shareReplay,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';

import type { IPublicMediaContinuationContext } from 'src/app/core/interfaces/media/i-public-media-continuation-context';
import {
  IPublicVideoItem,
  isPublicVideoPlaybackItem,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { IVideoComment } from 'src/app/core/interfaces/media/i-video-comment';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { normalizeUserAccountLifecycleStatus } from 'src/app/core/services/autentication/auth/account-lifecycle.policy';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import { NetworkStatusService } from 'src/app/core/services/network/network-status.service';
import { OFFLINE_USER_MESSAGE } from 'src/app/core/services/network/network-user-feedback.policy';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';
import { MediaVideoCommentsService } from 'src/app/core/services/media/media-video-comments.service';
import {
  MediaVideoRatingsService,
  VideoRatingSummary,
} from 'src/app/core/services/media/media-video-ratings.service';
import { PublicVideoAccessService } from 'src/app/core/services/media/public-video-access.service';
import { PublicVideoPlaybackExposureService } from 'src/app/core/services/media/public-video-playback-exposure.service';
import {
  canRetryExpiringPublicVideoAccess,
  classifyPublicVideoPlaybackFailure,
} from './public-video-playback-failure.policy';
import { classifyPublicVideoAccessRefreshFailure } from './public-video-access-refresh-failure.policy';
import { MEDIA_ERROR_CODE_MESSAGES } from 'src/app/core/services/media/media-error.catalog';
import { PublicVideoContinuationService } from 'src/app/core/services/media/public-video-continuation.service';
import type { PublicVideoContinuationResult } from 'src/app/core/services/media/public-video-continuation.service';
import {
  IPublicProfileVideoCursor,
  PublicProfileVideoPaginationService,
} from 'src/app/core/services/media/public-profile-video-pagination.service';
import {
  TVideoViewSource,
  VideoViewTrackingService,
} from 'src/app/core/services/media/video-view-tracking.service';
import { PublicVideoShareActionsComponent } from '../public-video-share-actions/public-video-share-actions.component';
import { PublicMediaBadgeComponent } from '../../shared/components/public-media-badge/public-media-badge.component';
import { PublicMediaRecommendationBadgeComponent } from '../../shared/components/public-media-recommendation-badge/public-media-recommendation-badge.component';
import {
  PUBLIC_MEDIA_VIEWER_BLOCKED_TARGET_SELECTOR,
  PublicMediaViewerSwipeGesture,
  canStartPublicMediaViewerSwipe,
  canUsePublicMediaViewerKeyboardNavigation,
  createPublicMediaViewerSwipeGesture,
  resolvePublicMediaViewerSwipeDirection,
  updatePublicMediaViewerSwipeGesture,
} from '../../shared/policies/public-media-viewer-navigation.policy';
import { PublicVideoPlaybackFeedbackDirective } from './public-video-playback-feedback.directive';
import {
  PublicVideoQualifiedViewDetail,
  PublicVideoViewQualificationDirective,
} from './public-video-view-qualification.directive';

export interface IPublicVideoViewerData {
  ownerUid: string;
  items: readonly IPublicVideoItem[];
  startIndex: number;
  source?: TVideoViewSource;
  continuationContext?: IPublicMediaContinuationContext;
  profileContinuationCursor?: IPublicProfileVideoCursor | null;
}

interface ViewerUserLike {
  uid?: string | null;
}

interface VideoCommentThread {
  root: IVideoComment;
  replies: IVideoComment[];
}

interface PendingPlaybackResume {
  currentTime: number;
  shouldResume: boolean;
}

type TAccessRefreshReason = 'automatic' | 'manual' | 'expiry';

const ACCESS_REFRESH_WINDOW_MS = 60_000;
const ACCESS_REFRESH_RETRY_MS = 15_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const CONTINUATION_PREFETCH_REMAINING_ITEMS = 2;
const CONTINUATION_BATCH_SIZE = 8;
const MAX_PROFILE_CONTINUATION_EMPTY_PAGES = 5;
const VIEWER_ITEM_WINDOW_MAX = 48;
const VIEWER_ITEM_RETAIN_BEHIND = 12;
const VIDEO_VIEWER_BLOCKED_TARGET_SELECTOR = `video,${PUBLIC_MEDIA_VIEWER_BLOCKED_TARGET_SELECTOR}`;
@Component({
  selector: 'app-public-video-viewer',
  standalone: true,
  imports: [
    CommonModule,
    A11yModule,
    RouterModule,
    ReactiveFormsModule,
    MatDialogModule,
    PublicVideoPlaybackFeedbackDirective,
    PublicVideoViewQualificationDirective,
    PublicVideoShareActionsComponent,
    PublicMediaBadgeComponent,
    PublicMediaRecommendationBadgeComponent,
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

  private readonly destroyRef = inject(DestroyRef);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly videoViewTracking = inject(VideoViewTrackingService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly publicVideoAccess = inject(PublicVideoAccessService);
  private readonly videoExposure = inject(PublicVideoPlaybackExposureService);
  private readonly publicVideoContinuation = inject(PublicVideoContinuationService);
  private readonly profileVideoPagination = inject(PublicProfileVideoPaginationService);
  private readonly reactions = inject(MediaReactionsService);
  private readonly comments = inject(MediaVideoCommentsService);
  private readonly ratings = inject(MediaVideoRatingsService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly mediaError = inject(MediaApplicationErrorService);
  private readonly networkStatus = inject(NetworkStatusService);
  private readonly recordedViewKeys = new Set<string>();
  private readonly revokedVideoKeys = new Set<string>();
  private observedAvailableVideoKey: string | null = null;
  private viewerLifecycleActive = false;
  private readonly automaticRefreshKeys = new Set<string>();
  private readonly items = [...(this.data.items ?? [])];

  private accessRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshingAccess = false;
  private accessRevision = 0;
  private expiryRefreshRetryCount = 0;
  private pendingPlaybackResume: PendingPlaybackResume | null = null;
  private swipeNavigationGesture: PublicMediaViewerSwipeGesture | null = null;
  private continuationExhausted = false;
  private profileCursor: IPublicProfileVideoCursor | null = null;
  private pendingContinuationAdvanceKey: string | null = null;

  @ViewChild('videoPlayer')
  private videoPlayer?: ElementRef<HTMLVideoElement>;

  @ViewChild(PublicVideoPlaybackFeedbackDirective)
  private playbackFeedback?: PublicVideoPlaybackFeedbackDirective;

  @ViewChild(PublicVideoViewQualificationDirective)
  private viewQualification?: PublicVideoViewQualificationDirective;

  index = 0;
  readonly ratingOptions = [1, 2, 3, 4, 5] as const;
  readonly commentsExpanded = signal(false);
  private readonly commentReloadSubject = new BehaviorSubject(0);
  readonly ratingsExpanded = signal(false);
  readonly navigationAnnouncement = signal('');
  readonly loadingContinuation = signal(false);
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

  private readonly currentVideoSubject =
    new BehaviorSubject<IPublicVideoItem | null>(null);
  readonly currentVideo$ = this.currentVideoSubject.pipe(
    shareReplay({ bufferSize: 1, refCount: true })
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

  readonly viewerIsOwner$ = combineLatest([
    this.viewerUid$,
    this.currentVideo$,
  ]).pipe(
    map(([uid, video]) => !!uid && !!video && uid === video.ownerUid),
    distinctUntilChanged(),
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

  readonly likesCount$ = this.currentVideo$.pipe(
    switchMap((video) => video
      ? this.reactions.getVideoLikesCount$(video.ownerUid, video.id)
      : of(0)),
    catchError(() => of(0)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly likedByViewer$ = combineLatest([
    this.currentVideo$,
    this.viewerUid$,
  ]).pipe(
    switchMap(([video, viewerUid]) => video
      ? this.reactions.isVideoLikedByViewer$(
          video.ownerUid,
          video.id,
          viewerUid
        )
      : of(false)),
    catchError(() => of(false)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly ratingSummary$ = this.currentVideo$.pipe(
    switchMap((video) => video
      ? this.ratings.watchSummary$(video.ownerUid, video.id)
      : of(this.emptyRatingSummary())),
    catchError(() => of(this.emptyRatingSummary())),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewerRating$ = combineLatest([
    this.currentVideo$,
    this.viewerUid$,
  ]).pipe(
    switchMap(([video, viewerUid]) => video
      ? this.ratings.watchViewerRating$(
          video.ownerUid,
          video.id,
          viewerUid
        )
      : of(null)),
    catchError(() => of(null)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly commentState$ = combineLatest([
    this.currentVideo$,
    this.commentReloadSubject,
  ]).pipe(
    switchMap(([video]) => {
      if (!video) {
        return of({
          status: 'ready' as const,
          items: [] as IVideoComment[],
          message: null as string | null,
        });
      }

      return this.comments.watchVisibleComments$(video.ownerUid, video.id).pipe(
        map((items) => ({
          status: 'ready' as const,
          items,
          message: null as string | null,
        })),
        startWith({
          status: 'loading' as const,
          items: [] as IVideoComment[],
          message: null as string | null,
        }),
        catchError((error: unknown) => {
          const diagnostic = this.mediaError.reportSilently(
            error, 'publicVideoViewer.watchVisibleComments', undefined,
            { scope: 'PublicVideoViewerComponent' },
            'video_comments_load_failed'
          );
          return of({
            status: 'error' as const,
            items: [] as IVideoComment[],
            message: diagnostic.userMessage,
          });
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly comments$ = this.commentState$.pipe(
    map((state) => state.items)
  );

  retryComments(): void {
    this.commentReloadSubject.next(this.commentReloadSubject.value + 1);
  }

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
    this.profileCursor = this.data.source === 'profile'
      ? this.data.profileContinuationCursor ?? null : null;
    this.continuationExhausted = this.data.source === 'profile' && !this.profileCursor;
    const itemsCount = this.items.length;
    this.index = itemsCount > 0
      ? Math.max(0, Math.min(this.data.startIndex ?? 0, itemsCount - 1))
      : 0;
    this.syncCurrentVideoId();
    queueMicrotask(() => {
      if (this.destroyRef.destroyed) return;
      this.ensureCurrentPlaybackAccess();
      this.prefetchContinuationIfNeeded();
    });

    this.viewerUid$.pipe(
      pairwise(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([previousUid, currentUid]) => {
      if (previousUid !== currentUid) {
        this.handleViewerSessionChanged(currentUid);
      }
    });

    // The account lifecycle is canonical. Do not add a second Media age gate.
    this.currentUserStore.user$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((user) => {
      const wasActive = this.viewerLifecycleActive;
      this.viewerLifecycleActive = !!user?.uid &&
        normalizeUserAccountLifecycleStatus(user) === 'active';
      if (!this.viewerLifecycleActive) {
        this.revokeCurrentVideoAccess();
      } else if (!wasActive && this.observedAvailableVideoKey) {
        // Account lifecycle is authoritative. A resumed account must still
        // obtain a NEW playback URL from the backend, never a revoked token.
        this.resumeCurrentVideoIfAuthorized(this.observedAvailableVideoKey);
      }
    });

    // Watch only the currently opened video. switchMap closes the previous
    // listener on navigation or session change. Restriction is fail-closed.
    combineLatest([
      this.currentVideo$.pipe(
        map((video) => this.videoKey(video)),
        distinctUntilChanged()
      ),
      this.viewerUid$,
    ]).pipe(
      switchMap(([key, viewerUid]) => {
        const video = this.current;
        if (!key || !viewerUid || !video) {
          return EMPTY;
        }
        return this.videoExposure.watchActiveVideo$(
          video.ownerUid, video.id, viewerUid
        ).pipe(
          map((allowed) => ({ key, allowed })),
          catchError(() => of({ key, allowed: false }))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(({ key, allowed }) => {
      if (key !== this.videoKey(this.current)) {
        return;
      }
      if (!allowed) {
        this.observedAvailableVideoKey = null;
        this.revokeCurrentVideoAccess();
        return;
      }
      this.observedAvailableVideoKey = key;
      this.resumeCurrentVideoIfAuthorized(key);
    });

    this.destroyRef.onDestroy(() => {
      this.clearAccessRefreshTimer();
      this.releaseCurrentPlayerSource();
    });
  }

  get current(): IPublicVideoItem | null {
    return this.items[this.index] ?? null;
  }

  get hasPrevious(): boolean {
    return this.index > 0;
  }

  get hasNext(): boolean {
    return this.index < this.items.length - 1 || !this.continuationExhausted;
  }

  get waitingForContinuation(): boolean {
    return this.loadingContinuation() && this.index >= this.items.length - 1;
  }

  get positionLabel(): string {
    const total = this.items.length;
    return total > 0 ? `${this.index + 1} de ${total}` : 'Sem vídeos';
  }

  @HostListener('document:keydown.arrowup', ['$event'])
  @HostListener('document:keydown.arrowleft', ['$event'])
  onArrowUp(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;

    if (
      !canUsePublicMediaViewerKeyboardNavigation(
        keyboardEvent,
        VIDEO_VIEWER_BLOCKED_TARGET_SELECTOR,
        this.commentsExpanded() || this.ratingsExpanded()
      ) ||
      !this.hasPrevious
    ) {
      return;
    }

    keyboardEvent.preventDefault();
    this.previous();
  }

  @HostListener('document:keydown.arrowdown', ['$event'])
  @HostListener('document:keydown.arrowright', ['$event'])
  onArrowDown(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;

    if (!canUsePublicMediaViewerKeyboardNavigation(
        keyboardEvent,
        VIDEO_VIEWER_BLOCKED_TARGET_SELECTOR,
        this.commentsExpanded() || this.ratingsExpanded()
      ) || !this.hasNext) {
      return;
    }

    keyboardEvent.preventDefault();
    this.next();
  }

  @HostListener('publicVideoAccessError')
  onPublicVideoAccessError(): void {
    const video = this.current;
    if (!video || this.revokedVideoKeys.has(this.videoKey(video))) return;

    const failure = classifyPublicVideoPlaybackFailure({
      offline: this.isNetworkOffline(),
      expiresAt: video.accessExpiresAt,
      now: Date.now(),
      mediaErrorCode: this.videoPlayer?.nativeElement.error?.code,
    });
    if (failure === 'offline') {
      this.playbackFeedback?.markError(
        OFFLINE_USER_MESSAGE
      );
    } else if (failure === 'expired') {
      this.refreshCurrentVideoAccess('expiry');
    } else if (failure === 'network') {
      this.refreshCurrentVideoAccess('automatic');
    } else {
      this.playbackFeedback?.markError(
        'Não foi possível reproduzir este arquivo. Tente novamente.'
      );
    }
  }

  @HostListener('publicVideoRetry')
  retryCurrentVideo(): void {
    this.refreshCurrentVideoAccess('manual');
  }

  @HostListener('publicVideoReady')
  onPublicVideoReady(): void {
    this.syncViewQualification();
    this.restorePlaybackAfterRefresh();
  }

  @HostListener('publicVideoQualifiedView', ['$event'])
  onPublicVideoQualifiedView(event: Event): void {
    const detail = (event as CustomEvent<PublicVideoQualifiedViewDetail>).detail;
    this.recordQualifiedVideoView(detail);
  }

  @HostListener('publicVideoPosterError')
  onPublicVideoPosterError(): void {
    const video = this.current;

    if (!video?.posterUrl) {
      return;
    }

    const updated: IPublicVideoItem = {
      ...video,
      posterUrl: null,
      posterAccess: 'NONE',
    };
    this.items[this.index] = updated;
    this.currentVideoSubject.next(updated);
    this.changeDetector.markForCheck();
  }

  onSwipePointerDown(event: PointerEvent): void {
    if (!canStartPublicMediaViewerSwipe(event, {
      axis: 'vertical',
      blockedTargetSelector: VIDEO_VIEWER_BLOCKED_TARGET_SELECTOR,
      navigationAvailable: this.hasPrevious || this.hasNext,
      disabled: this.commentsExpanded() || this.ratingsExpanded(),
    })) {
      this.cancelSwipeNavigation();
      return;
    }

    this.swipeNavigationGesture = createPublicMediaViewerSwipeGesture(event);
  }

  onSwipePointerMove(event: PointerEvent): void {
    const gesture = this.swipeNavigationGesture;

    if (
      gesture &&
      updatePublicMediaViewerSwipeGesture(gesture, event, 'vertical') &&
      event.cancelable
    ) {
      event.preventDefault();
    }
  }

  onSwipePointerUp(event: PointerEvent): void {
    const gesture = this.swipeNavigationGesture;
    this.swipeNavigationGesture = null;

    if (!gesture) {
      return;
    }

    const direction = resolvePublicMediaViewerSwipeDirection(
      gesture,
      event,
      'vertical'
    );

    if (direction === 'next') {
      this.next();
    } else if (direction === 'previous') {
      this.previous();
    }
  }

  cancelSwipeNavigation(): void {
    this.swipeNavigationGesture = null;
  }

  close(): void {
    this.cancelSwipeNavigation();
    this.releaseCurrentPlayerSource();
    this.dialogRef.close();
  }

  previous(): void {
    if (this.hasPrevious) {
      this.pendingContinuationAdvanceKey = null;
      this.changeIndex(this.index - 1);
    }
  }

  next(): void {
    if (this.index < this.items.length - 1) {
      this.pendingContinuationAdvanceKey = null;
      this.changeIndex(this.index + 1);
      return;
    }

    if (this.continuationExhausted) {
      return;
    }

    this.pendingContinuationAdvanceKey = this.videoKey(this.current);
    this.loadContinuation();
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
            video.ownerUid,
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
            video.ownerUid,
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
            ownerUid: video.ownerUid,
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
            ownerUid: video.ownerUid,
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
                  video.ownerUid,
                  video.id,
                  comment.id
                )
              : of(null);
          }
          return this.canDeleteComment(comment, viewerUid, viewerIsOwner)
            ? this.comments.deleteComment$(
                video.ownerUid,
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
    this.cancelSwipeNavigation();
    this.releaseCurrentPlayerSource();
    this.clearAccessRefreshTimer();
    this.accessRevision += 1;
    this.refreshingAccess = false;
    this.pendingContinuationAdvanceKey = null;
    this.observedAvailableVideoKey = null;
    this.expiryRefreshRetryCount = 0;
    this.index = nextIndex;
    this.commentsExpanded.set(false);
    this.ratingsExpanded.set(false);
    this.commentControl.setValue('');
    this.cancelReply();
    this.pendingPlaybackResume = null;
    this.playbackFeedback?.beginAuthorization('Preparando vídeo...');
    this.syncCurrentVideoId();
    this.announceCurrentVideo();

    // Rapid navigation A→B→A cannot execute callbacks from earlier indices.
    const revision = this.accessRevision;
    queueMicrotask(() => {
      if (this.destroyRef.destroyed || this.accessRevision !== revision) {
        return;
      }
      this.ensureCurrentPlaybackAccess();
      this.prefetchContinuationIfNeeded();
    });
  }

  private prefetchContinuationIfNeeded(): void {
    if (
      this.continuationExhausted ||
      this.loadingContinuation() ||
      !this.current
    ) {
      return;
    }

    const remainingItems = Math.max(0, this.items.length - this.index - 1);

    if (remainingItems <= CONTINUATION_PREFETCH_REMAINING_ITEMS) {
      this.loadContinuation();
    }
  }

  private loadContinuation(): void {
    if (
      this.continuationExhausted ||
      this.loadingContinuation() ||
      !this.current
    ) {
      return;
    }

    this.loadingContinuation.set(true);
    const continuation$ = this.data.source === 'profile'
      ? this.loadProfileContinuation$()
      : this.viewerUid$.pipe(
          take(1),
          switchMap((viewerUid) =>
            this.publicVideoContinuation.loadContinuation$({
              existingItems: this.items,
              source: this.data.source ?? 'unknown',
              excludeOwnerUid: viewerUid,
              limit: CONTINUATION_BATCH_SIZE,
              continuationContext: this.data.continuationContext,
            })
          )
        );

    continuation$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.loadingContinuation.set(false);
          this.changeDetector.markForCheck();
        })
      )
      .subscribe((result) => {
        const pendingAdvanceKey = this.pendingContinuationAdvanceKey;
        const currentKey = this.videoKey(this.current);

        if (result.exhausted) {
          this.continuationExhausted = true;
        }

        const appendedCount = this.appendContinuationItems(result.items);
        this.trimViewerItemWindow();
        this.changeDetector.markForCheck();

        if (
          pendingAdvanceKey &&
          pendingAdvanceKey === currentKey &&
          this.index < this.items.length - 1
        ) {
          this.pendingContinuationAdvanceKey = null;
          this.changeIndex(this.index + 1);
          return;
        }

        if (pendingAdvanceKey && pendingAdvanceKey === currentKey) {
          this.pendingContinuationAdvanceKey = null;

          if (result.failed) {
            this.errorNotification.showWarning(
              'Não foi possível carregar o próximo vídeo agora. Tente novamente.'
            );
          } else if (result.exhausted) {
            this.navigationAnnouncement.set(
              'Não há mais vídeos públicos disponíveis para continuar.'
            );
          }
        }

        if (appendedCount > 0) {
          this.prefetchContinuationIfNeeded();
        }
      });
  }

  private loadProfileContinuation$(
    cursor: IPublicProfileVideoCursor | null = this.profileCursor,
    attemptedPages = 0
  ): Observable<PublicVideoContinuationResult> {
    if (!cursor) {
      return of({ items: [], exhausted: true, failed: false });
    }

    return this.profileVideoPagination.loadPage$(this.data.ownerUid, {
      pageSize: 12, cursor,
    }).pipe(
      take(1),
      switchMap((page) => {
        const next = page.hasMore ? page.nextCursor : null;
        const stalled = page.hasMore &&
          (!next || next.documentId === cursor.documentId);
        this.profileCursor = stalled ? null : next;
        const alreadyLoaded = new Set(
          this.items.map((item) => this.videoKey(item))
        );
        const eligible = page.items.filter((item) =>
          item.ownerUid === this.data.ownerUid &&
          item.mediaType === 'VIDEO' &&
          (item.visibility === 'PUBLIC' || item.visibility === 'FRIENDS') &&
          item.moderationStatus === 'APPROVED' &&
          !!this.videoKey(item) &&
          !alreadyLoaded.has(this.videoKey(item))
        );

        if (stalled) {
          // A broken cursor must not trap the user in repeated requests.
          this.mediaError.reportReasonSilently(
            'media_discovery_page_failed',
            'loadProfileVideoContinuation',
            {
              scope: 'PublicVideoViewerComponent',
              hasOwnerUid: !!this.data.ownerUid,
              invalidCursor: true,
            }
          );
        }

        if (
          eligible.length === 0 &&
          this.profileCursor &&
          attemptedPages + 1 < MAX_PROFILE_CONTINUATION_EMPTY_PAGES
        ) {
          return this.loadProfileContinuation$(
            this.profileCursor, attemptedPages + 1
          );
        }

        return of({
          items: eligible,
          exhausted: !this.profileCursor,
          // If the bounded scan found no playable neighbor, allow a
          // deliberate retry rather than silently freezing navigation.
          failed: eligible.length === 0 &&
            (stalled || !!this.profileCursor),
        });
      }),
      catchError((error: unknown) => {
        this.mediaError.report(error, {
          operation: 'loadProfileVideoContinuation',
          reasonHint: 'media_discovery_page_failed',
          metadata: {
            scope: 'PublicVideoViewerComponent',
            hasOwnerUid: !!this.data.ownerUid,
          },
        });
        return of({ items: [], exhausted: false, failed: true });
      })
    );
  }

  private appendContinuationItems(
    candidates: readonly IPublicVideoItem[]
  ): number {
    const seen = new Set(this.items.map((item) => this.videoKey(item)));
    let appendedCount = 0;

    for (const candidate of candidates) {
      const key = this.videoKey(candidate);

      if (!key || seen.has(key) ||
          candidate.mediaType !== 'VIDEO' ||
          (candidate.visibility !== 'PUBLIC' && candidate.visibility !== 'FRIENDS') ||
          candidate.moderationStatus !== 'APPROVED' ||
          (this.data.source === 'profile' && candidate.ownerUid !== this.data.ownerUid)) {
        continue;
      }

      seen.add(key);
      this.items.push(candidate);
      appendedCount += 1;
    }

    return appendedCount;
  }

  private trimViewerItemWindow(): void {
    const overflow = this.items.length - VIEWER_ITEM_WINDOW_MAX;
    if (overflow <= 0) return;

    const removableFromStart = Math.min(
      overflow,
      Math.max(0, this.index - VIEWER_ITEM_RETAIN_BEHIND)
    );
    if (removableFromStart <= 0) return;

    const removed = this.items.splice(0, removableFromStart);
    this.index -= removableFromStart;

    for (const item of removed) {
      this.publicVideoAccess.invalidatePublicVideoAccess(item);
      this.recordedViewKeys.delete(this.videoKey(item));

      const refreshPrefix = `${item.ownerUid}:${item.id}:`;
      for (const key of this.automaticRefreshKeys) {
        if (key.startsWith(refreshPrefix)) {
          this.automaticRefreshKeys.delete(key);
        }
      }
    }
  }

  private syncCurrentVideoId(): void {
    const current = this.current;
    this.currentVideoIdSubject.next(current?.id ?? '');
    this.currentVideoSubject.next(current);
    this.changeDetector.markForCheck();
  }

  private announceCurrentVideo(): void {
    const current = this.current;

    if (!current) {
      this.navigationAnnouncement.set('');
      return;
    }

    const title = current.title?.trim() ||
      current.alt?.trim() ||
      'Vídeo do perfil';
    this.navigationAnnouncement.set(`${this.positionLabel}. ${title}.`);
  }

  private syncViewQualification(): void {
    const video = this.current;

    if (!video || !isPublicVideoPlaybackItem(video)) {
      return;
    }

    this.viewQualification?.resetForVideo(
      `${video.ownerUid}:${video.id}`
    );
  }

  private recordQualifiedVideoView(
    evidence: PublicVideoQualifiedViewDetail | null | undefined
  ): void {
    const video = this.current;
    const ownerUid = (video?.ownerUid ?? '').trim();
    const videoId = (video?.id ?? '').trim();
    const viewKey = `${ownerUid}:${videoId}`;

    if (
      !ownerUid ||
      !videoId ||
      !evidence ||
      this.recordedViewKeys.has(viewKey)
    ) {
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
            this.data.source ?? 'unknown',
            evidence
          );
        }),
        catchError(() => {
          this.recordedViewKeys.delete(viewKey);
          return EMPTY;
        })
      )
      .subscribe((recorded) => {
        if (!recorded) {
          this.recordedViewKeys.delete(viewKey);
        }
      });
  }

  private ensureCurrentPlaybackAccess(): void {
    const video = this.current;

    if (this.destroyRef.destroyed || !this.viewerLifecycleActive ||
        !video || this.revokedVideoKeys.has(this.videoKey(video))) {
      return;
    }

    if (isPublicVideoPlaybackItem(video)) {
      this.scheduleAccessRefresh();
      this.loadCurrentPlayer();
      return;
    }

    if (this.refreshingAccess) {
      return;
    }

    const revision = this.accessRevision;
    const targetIndex = this.index;
    const ownerUid = video.ownerUid;
    const videoId = video.id;

    this.refreshingAccess = true;
    this.clearAccessRefreshTimer();
    this.playbackFeedback?.markLoading('Preparando vídeo...');

    this.publicVideoAccess.hydratePublicVideoUrls$([video])
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (this.accessRevision === revision) {
            this.refreshingAccess = false;
          }
        })
      )
      .subscribe({
        next: (items) => {
          const hydrated = items[0] ?? null;

          if (!this.isCurrentAccessTarget(
            revision,
            targetIndex,
            ownerUid,
            videoId
          )) {
            return;
          }

          if (!hydrated || !isPublicVideoPlaybackItem(hydrated)) {
            this.handleAccessRefreshFailure('manual');
            return;
          }

          this.expiryRefreshRetryCount = 0;
          this.items[targetIndex] = hydrated;
          this.currentVideoSubject.next(hydrated);
          this.changeDetector.markForCheck();
          this.scheduleAccessRefresh();
          this.loadCurrentPlayer();
        },
        error: (error: unknown) => {
          if (this.isCurrentAccessTarget(
            revision,
            targetIndex,
            ownerUid,
            videoId
          )) {
            this.handleAccessRefreshFailure('manual', error);
          }
        },
      });
  }

  private refreshCurrentVideoAccess(reason: TAccessRefreshReason): void {
    const video = this.current;

    if (this.destroyRef.destroyed || !this.viewerLifecycleActive ||
        !video || this.revokedVideoKeys.has(this.videoKey(video))) {
      return;
    }

    if (this.isNetworkOffline()) {
      this.playbackFeedback?.markError(
        OFFLINE_USER_MESSAGE
      );
      return;
    }

    if (!isPublicVideoPlaybackItem(video)) {
      this.ensureCurrentPlaybackAccess();
      return;
    }

    if (this.refreshingAccess) {
      return;
    }

    const revision = this.accessRevision;
    const targetIndex = this.index;
    const ownerUid = video.ownerUid;
    const videoId = video.id;
    const refreshKey = `${ownerUid}:${videoId}:${video.url}`;

    if (reason === 'automatic' && this.automaticRefreshKeys.has(refreshKey)) {
      this.playbackFeedback?.markError(
        'O vídeo continua indisponível. Tente novamente em instantes.'
      );
      return;
    }

    if (reason === 'automatic') {
      this.automaticRefreshKeys.add(refreshKey);
    }

    this.refreshingAccess = true;
    this.clearAccessRefreshTimer();
    this.pendingPlaybackResume = this.capturePlaybackState();
    this.playbackFeedback?.markRefreshing(
      reason === 'expiry'
        ? 'Renovando acesso ao vídeo...'
        : 'Atualizando acesso ao vídeo...'
    );

    this.publicVideoAccess.refreshPublicVideoUrl$(video)
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (this.accessRevision === revision) {
            this.refreshingAccess = false;
          }
        })
      )
      .subscribe({
        next: (refreshed) => {
          if (!this.isCurrentAccessTarget(
            revision,
            targetIndex,
            ownerUid,
            videoId
          )) {
            return;
          }

          if (!refreshed || !isPublicVideoPlaybackItem(refreshed)) {
            this.handleAccessRefreshFailure(reason);
            return;
          }

          this.expiryRefreshRetryCount = 0;
          this.items[targetIndex] = refreshed;
          this.currentVideoSubject.next(refreshed);
          this.changeDetector.markForCheck();
          this.scheduleAccessRefresh();
          this.loadCurrentPlayer();
        },
        error: (error: unknown) => {
          if (this.isCurrentAccessTarget(
            revision,
            targetIndex,
            ownerUid,
            videoId
          )) {
            this.handleAccessRefreshFailure(reason, error);
          }
        },
      });
  }

  private isNetworkOffline(): boolean {
    return !this.networkStatus.isOnlineSnapshot();
  }

  private handleAccessRefreshFailure(
    reason: TAccessRefreshReason,
    error?: unknown
  ): void {
    const failure = classifyPublicVideoAccessRefreshFailure(error);

    if (failure === 'permission-denied' ||
        failure === 'unauthenticated' ||
        failure === 'not-found') {
      // Backend negou novo acesso: não manter uma URL anteriormente emitida.
      // A conta permanece governada pelo lifecycle canônico, não por Media.
      this.observedAvailableVideoKey = null;
      this.revokeCurrentVideoAccess(
        MEDIA_ERROR_CODE_MESSAGES[failure] ?? 'Este vídeo não está disponível.'
      );
      return;
    }

    const mayRetryExpiry = failure === 'unavailable' ||
      failure === 'deadline-exceeded' || failure === 'unknown';
    if (reason === 'expiry' && mayRetryExpiry) {
      const video = this.current;
      if (canRetryExpiringPublicVideoAccess({
        offline: this.isNetworkOffline(),
        expiresAt: video?.accessExpiresAt,
        now: Date.now(),
        retriesUsed: this.expiryRefreshRetryCount,
        retryDelayMs: ACCESS_REFRESH_RETRY_MS,
      })) {
        this.expiryRefreshRetryCount += 1;
        this.playbackFeedback?.markRefreshing(
          'Não foi possível renovar. Tentando mais uma vez...'
        );
        this.errorNotification.showWarning(
          'A renovação falhou. Uma última tentativa será realizada.'
        );
        const revision = this.accessRevision;
        this.accessRefreshTimer = setTimeout(() => {
          if (!this.destroyRef.destroyed && this.accessRevision === revision) {
            this.refreshCurrentVideoAccess('expiry');
          }
        }, ACCESS_REFRESH_RETRY_MS);
        return;
      }
    }

    // Até em falhas temporárias, a credencial anterior não deve ser
    // reutilizada depois de uma renovação rejeitada ou sem resultado.
    this.discardCurrentPlaybackAccess();
    this.pendingPlaybackResume = null;
    const message = this.isNetworkOffline()
      ? OFFLINE_USER_MESSAGE
      : failure !== 'unknown'
        ? MEDIA_ERROR_CODE_MESSAGES[failure]
        : reason === 'expiry'
          ? 'A autorização do vídeo expirou. Tente novamente.'
          : 'O acesso ao vídeo não pôde ser atualizado. Tente novamente.';
    this.playbackFeedback?.markError(message);

    // PublicVideoAccessService já relatou os erros de callable
    // silenciosamente. Não emitir segundo diagnóstico do mesmo erro.
    if (error == null && reason !== 'expiry') {
      this.mediaError.reportReason('video_playback_access_failed', {
        operation: 'publicVideoViewer.refreshAccess',
        metadata: {
          scope: 'PublicVideoViewerComponent',
          reason,
        },
      });
    }
  }

  private discardCurrentPlaybackAccess(): void {
    const video = this.current;
    if (!video) return;
    this.clearAccessRefreshTimer();
    this.releaseCurrentPlayerSource();
    this.publicVideoAccess.invalidatePublicVideoAccess(video);
    const previewOnly: IPublicVideoItem = {
      ...video, url: null, accessExpiresAt: 0,
    };
    this.items[this.index] = previewOnly;
    this.currentVideoSubject.next(previewOnly);
    this.accessRevision += 1;
    this.refreshingAccess = false;
    this.changeDetector.markForCheck();
  }

  private scheduleAccessRefresh(): void {
    this.clearAccessRefreshTimer();

    const video = this.current;
    if (!isPublicVideoPlaybackItem(video)) {
      return;
    }

    const expiresAt = Number(video.accessExpiresAt ?? 0);

    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
      return;
    }

    const revision = this.accessRevision;
    const delay = expiresAt - Date.now() - ACCESS_REFRESH_WINDOW_MS;

    if (delay <= 0) {
      queueMicrotask(() => {
        if (this.accessRevision === revision) {
          this.refreshCurrentVideoAccess('expiry');
        }
      });
      return;
    }

    this.accessRefreshTimer = setTimeout(() => {
      if (this.accessRevision === revision) {
        this.refreshCurrentVideoAccess('expiry');
      }
    }, Math.min(delay, MAX_TIMER_DELAY_MS));
  }

  private isCurrentAccessTarget(
    revision: number,
    targetIndex: number,
    ownerUid: string,
    videoId: string
  ): boolean {
    const current = this.current;

    return !this.destroyRef.destroyed && this.viewerLifecycleActive &&
      this.accessRevision === revision &&
      this.index === targetIndex &&
      current?.ownerUid === ownerUid &&
      current.id === videoId;
  }

  private loadCurrentPlayer(): void {
    queueMicrotask(() => {
      const player = this.videoPlayer?.nativeElement;
      const current = this.current;

      if (!player || !isPublicVideoPlaybackItem(current)) {
        return;
      }

      this.syncViewQualification();
      player.load();
    });
  }

  private clearAccessRefreshTimer(): void {
    if (this.accessRefreshTimer === null) {
      return;
    }

    clearTimeout(this.accessRefreshTimer);
    this.accessRefreshTimer = null;
  }

  private capturePlaybackState(): PendingPlaybackResume | null {
    const player = this.videoPlayer?.nativeElement;

    if (!player) {
      return null;
    }

    const currentTime = Number.isFinite(player.currentTime)
      ? Math.max(0, player.currentTime)
      : 0;

    return {
      currentTime,
      shouldResume: !player.paused && !player.ended,
    };
  }

  private restorePlaybackAfterRefresh(): void {
    const pending = this.pendingPlaybackResume;
    const player = this.videoPlayer?.nativeElement;

    if (!pending || !player || player.readyState < 1) {
      return;
    }

    this.pendingPlaybackResume = null;

    try {
      if (pending.currentTime > 0 && pending.currentTime < player.duration) {
        player.currentTime = pending.currentTime;
      }
    } catch {
      // O navegador pode rejeitar seek antes de concluir os metadados.
    }

    if (pending.shouldResume) {
      void player.play().catch(() => {
        // Autoplay pode ser bloqueado; os controles continuam disponíveis.
      });
    }
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

  private videoKey(item: IPublicVideoItem | null | undefined): string {
    const ownerUid = String(item?.ownerUid ?? '').trim();
    const videoId = String(item?.id ?? '').trim();
    return ownerUid && videoId ? `${ownerUid}:${videoId}` : '';
  }

  private revokeCurrentVideoAccess(
    message = 'Este vídeo não está mais disponível.'
  ): void {
    const current = this.current;
    const key = this.videoKey(current);

    if (!current || !key || this.revokedVideoKeys.has(key)) {
      return;
    }

    this.revokedVideoKeys.add(key);
    this.releaseCurrentPlayerSource();
    this.clearAccessRefreshTimer();
    this.accessRevision += 1;
    this.refreshingAccess = false;
    this.expiryRefreshRetryCount = 0;
    this.pendingPlaybackResume = null;
    this.publicVideoAccess.invalidatePublicVideoAccess(current);

    const projectionOnly: IPublicVideoItem = {
      ...current, url: null, posterUrl: null, accessExpiresAt: 0,
    };
    this.items[this.index] = projectionOnly;
    this.currentVideoSubject.next(projectionOnly);
    this.playbackFeedback?.markRevoked(message);
    this.changeDetector.markForCheck();
  }

  private resumeCurrentVideoIfAuthorized(key: string): void {
    const current = this.current;
    if (!this.viewerLifecycleActive || !current ||
        key !== this.videoKey(current) ||
        !this.revokedVideoKeys.has(key)) {
      return;
    }

    // A new positive observation only permits requesting authorization.
    // Discard old signed URLs and every in-flight response started before it.
    this.publicVideoAccess.invalidatePublicVideoAccess(current);
    this.revokedVideoKeys.delete(key);
    const prefix = `${current.ownerUid}:${current.id}:`;
    for (const refreshKey of this.automaticRefreshKeys) {
      if (refreshKey.startsWith(prefix)) {
        this.automaticRefreshKeys.delete(refreshKey);
      }
    }
    this.playbackFeedback?.beginAuthorization(
      'Restabelecendo acesso ao vídeo...'
    );

    // Defer rehydration so a same-turn restriction can revoke it before
    // issuing a request. Repeated true emissions cannot trigger another one.
    const revision = this.accessRevision;
    queueMicrotask(() => {
      if (!this.destroyRef.destroyed &&
          this.accessRevision === revision &&
          this.viewerLifecycleActive &&
          this.observedAvailableVideoKey === key &&
          !this.revokedVideoKeys.has(key) &&
          key === this.videoKey(this.current)) {
        this.ensureCurrentPlaybackAccess();
      }
    });
  }

  private handleViewerSessionChanged(viewerUid: string | null): void {
    const current = this.current;
    this.observedAvailableVideoKey = null;
    this.revokedVideoKeys.clear();

    this.releaseCurrentPlayerSource();
    this.clearAccessRefreshTimer();
    this.accessRevision += 1;
    this.refreshingAccess = false;
    this.expiryRefreshRetryCount = 0;
    this.pendingPlaybackResume = null;
    this.automaticRefreshKeys.clear();
    this.recordedViewKeys.clear();

    if (!current) {
      return;
    }

    this.publicVideoAccess.invalidatePublicVideoAccess(current);

    const projectionOnly: IPublicVideoItem = {
      ...current,
      url: null,
      accessExpiresAt: 0,
    };

    this.items[this.index] = projectionOnly;
    this.currentVideoSubject.next(projectionOnly);
    this.changeDetector.markForCheck();

    if (viewerUid) {
      this.playbackFeedback?.beginAuthorization('Preparando vídeo...');
    } else {
      this.playbackFeedback?.markRevoked('Entre novamente para assistir.');
    }
    if (viewerUid) {
      const revision = this.accessRevision;
      queueMicrotask(() => {
        if (this.destroyRef.destroyed || this.accessRevision !== revision ||
            !this.viewerLifecycleActive) {
          return;
        }
        this.ensureCurrentPlaybackAccess();
      });
    }
  }

  private releaseCurrentPlayerSource(): void {
    const player = this.videoPlayer?.nativeElement;
    if (!player) return;

    try {
      player.pause();
      player.removeAttribute('src');
      player.load();
    } catch {
      // Limpeza best-effort; nunca bloqueia fechamento/navegação.
    }
  }
}
