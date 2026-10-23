// src/app/media/videos/public-profile-videos/public-profile-videos.component.ts
// -----------------------------------------------------------------------------
// Galeria pública de vídeos aprovados de um perfil.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  combineLatest,
  defer,
  from,
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
  tap,
} from 'rxjs/operators';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import {
  IPublicProfileVideoCursor,
  PublicProfileVideoPaginationService,
} from 'src/app/core/services/media/public-profile-video-pagination.service';
import { PublicVideoShareService } from 'src/app/core/services/media/public-video-share.service';
import { ReportContentButtonComponent } from 'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';
import { PageHeaderComponent } from 'src/app/shared/page-header/page-header.component';
import { PublicVideoCardComponent } from '../../shared/components/public-video-card/public-video-card.component';
import { PublicVideoViewerLauncherService } from '../public-video-viewer/public-video-viewer-launcher.service';

interface PublicProfileVideosState {
  status: 'loading' | 'ready' | 'empty' | 'error';
  items: IPublicVideoItem[];
  renderItems: IPublicVideoItem[];
  renderStart: number;
  hasEarlierRenderWindow: boolean;
  hasLaterRenderWindow: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  /** Correlates asynchronous state with its originating router context. */
  routeIdentity: string;
}

interface ViewerUserLike {
  uid?: string | null;
}

interface PublicVideoGalleryRoute {
  readonly ownerUid: string;
  readonly requestedVideoId: string;
}

function routeIdentity(route: PublicVideoGalleryRoute): string {
  return `${route.ownerUid.length}:${route.ownerUid}:${route.requestedVideoId}`;
}

const PUBLIC_VIDEO_GALLERY_PAGE_SIZE = 12;
const PUBLIC_VIDEO_RENDER_WINDOW_MAX_ITEMS = 36;
const PUBLIC_VIDEO_RENDER_WINDOW_STEP = 12;

@Component({
  selector: 'app-public-profile-videos',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PageHeaderComponent,
    ReportContentButtonComponent,
    ContentStateComponent,
    PublicVideoCardComponent,
  ],
  templateUrl: './public-profile-videos.component.html',
  styleUrls: ['./public-profile-videos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicProfileVideosComponent implements OnInit {
  @ViewChild('videoGallery') private videoGallery?: ElementRef<HTMLElement>;

  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly videoPagination = inject(PublicProfileVideoPaginationService);
  private readonly publicVideoShare = inject(PublicVideoShareService);
  private readonly videoViewerLauncher = inject(PublicVideoViewerLauncherService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly mediaError = inject(MediaApplicationErrorService);

  private readonly refreshSubject = new BehaviorSubject<number>(0);
  private readonly galleryPagesSubject = new BehaviorSubject<
    readonly (readonly IPublicVideoItem[])[]
  >([]);
  private readonly galleryLoadingMoreSubject = new BehaviorSubject<boolean>(false);
  private readonly galleryRenderStartSubject = new BehaviorSubject<number>(0);
  private readonly autoOpenedVideoKeys = new Set<string>();
  private lastRequestedRouteIdentity: string | null = null;
  private deepLinkRouteGeneration = 0;
  private galleryRouteIdentity = '';
  private galleryOwnerUid = '';
  private galleryCursor: IPublicProfileVideoCursor | null = null;
  private galleryHasMore = false;
  private galleryRevision = 0;
  private deepLinkWatcherStarted = false;

  readonly viewerOpening = signal(false);
  readonly openingVideoId = signal<string | null>(null);
  readonly sharingVideoId = signal<string | null>(null);
  readonly failedPosterKeys = signal<ReadonlySet<string>>(new Set<string>());

  readonly viewerUid$: Observable<string | null> =
    this.currentUserStore.user$.pipe(
      map((user) => (user as ViewerUserLike | null)?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  // One atomic route context prevents a mixed owner/video pair while the
  // router reuses the gallery component for a different media deep link.
  readonly galleryRoute$: Observable<PublicVideoGalleryRoute> = this.route.paramMap.pipe(
    map((params) => ({
      ownerUid: (params.get('id') ?? params.get('ownerUid') ?? '').trim(),
      requestedVideoId: (params.get('videoId') ?? '').trim(),
    })),
    distinctUntilChanged((a, b) =>
      a.ownerUid === b.ownerUid && a.requestedVideoId === b.requestedVideoId
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly ownerUid$: Observable<string> = this.galleryRoute$.pipe(
    map((route) => route.ownerUid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly requestedVideoId$: Observable<string> = this.galleryRoute$.pipe(
    map((route) => route.requestedVideoId),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$: Observable<PublicProfileVideosState> = combineLatest([
    this.galleryRoute$,
    this.refreshSubject,
  ]).pipe(
    switchMap(([route]) => {
      const { ownerUid, requestedVideoId } = route;
      this.galleryRouteIdentity = routeIdentity(route);
      if (!ownerUid) {
        this.resetGallery('');
        return of(this.buildState('empty', []));
      }

      if (requestedVideoId) {
        this.resetGallery('');

        return this.mediaPublicQuery
          .getPublicVideoById$(ownerUid, requestedVideoId, {
            propagateErrors: true,
          })
          .pipe(
            map((item) =>
              this.buildState(item ? 'ready' : 'empty', item ? [item] : [])
            ),
            startWith(this.buildState('loading', [])),
            catchError((error: unknown) => {
              this.reportError(error, ownerUid, requestedVideoId);
              return of(this.buildState('error', []));
            })
          );
      }

      this.resetGallery(ownerUid);
      const revision = this.galleryRevision;

      return this.videoPagination.loadPage$(ownerUid, {
        pageSize: PUBLIC_VIDEO_GALLERY_PAGE_SIZE,
      }).pipe(
        switchMap((page) => {
          if (
            this.galleryOwnerUid !== ownerUid ||
            this.galleryRevision !== revision
          ) {
            return of(this.buildState('empty', []));
          }

          this.galleryCursor = page.nextCursor;
          this.galleryHasMore = page.hasMore;
          this.galleryPagesSubject.next([page.items]);

          return combineLatest([
            this.galleryPagesSubject,
            this.galleryLoadingMoreSubject,
            this.galleryRenderStartSubject,
          ]).pipe(
            map(([pages, loadingMore, requestedRenderStart]) => {
              const items = this.mergeGalleryPages(pages);

              return this.buildState(
                items.length > 0 ? 'ready' : 'empty',
                items,
                this.galleryHasMore,
                loadingMore,
                requestedRenderStart
              );
            })
          );
        }),
        startWith(this.buildState('loading', [])),
        catchError((error: unknown) => {
          if (
            this.galleryOwnerUid === ownerUid &&
            this.galleryRevision === revision
          ) {
            this.reportError(error, ownerUid, null);
          }
          return of(this.buildState('error', []));
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  ngOnInit(): void {
    this.watchRequestedVideo();
  }

  retry(): void {
    this.autoOpenedVideoKeys.clear();
    this.failedPosterKeys.set(new Set<string>());
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  loadMoreVideos(): void {
    const ownerUid = this.galleryOwnerUid;
    const cursor = this.galleryCursor;
    const revision = this.galleryRevision;

    if (
      !ownerUid ||
      !cursor ||
      !this.galleryHasMore ||
      this.galleryLoadingMoreSubject.value
    ) {
      return;
    }

    this.galleryLoadingMoreSubject.next(true);

    this.videoPagination.loadPage$(ownerUid, {
      pageSize: PUBLIC_VIDEO_GALLERY_PAGE_SIZE,
      cursor,
    }).pipe(
      take(1),
      tap((page) => {
        if (
          this.galleryOwnerUid !== ownerUid ||
          this.galleryRevision !== revision
        ) {
          return;
        }

        this.galleryCursor = page.nextCursor;
        this.galleryHasMore = page.hasMore;
        const nextPages = [
          ...this.galleryPagesSubject.value,
          page.items,
        ];
        this.galleryPagesSubject.next(nextPages);
        // Do not unmount the visitor's visible cards after pagination.
        // Older cards are reached through the explicit gallery window controls.
      }),
      catchError((error: unknown) => {
        if (
          this.galleryOwnerUid === ownerUid &&
          this.galleryRevision === revision
        ) {
          this.mediaError.report(error, {
            operation: 'loadMorePublicProfileVideos',
            reasonHint: 'media_discovery_page_failed',
            metadata: {
              scope: 'PublicProfileVideosComponent',
              hasOwnerUid: true,
              hasCursor: true,
            },
          });
        }

        return EMPTY;
      }),
      finalize(() => {
        if (
          this.galleryOwnerUid === ownerUid &&
          this.galleryRevision === revision
        ) {
          this.galleryLoadingMoreSubject.next(false);
        }
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  openVideo(
    index: number,
    expectedVideo?: Pick<IPublicVideoItem, 'id' | 'ownerUid'>
  ): void {
    // Gallery windows are reactive: an obsolete or missing card must never
    // be clamped onto the first/last video after pagination or route changes.
    if (this.viewerOpening() || !Number.isInteger(index) || index < 0) {
      return;
    }

    this.state$.pipe(
      take(1),
      switchMap((state) => {
        if (state.status !== 'ready' || !state.items.length) {
          this.errorNotification.showWarning(
            'Nenhum vídeo público disponível.'
          );
          return EMPTY;
        }

        if (
          state.routeIdentity !== this.galleryRouteIdentity ||
          index >= state.items.length
        ) {
          return EMPTY;
        }

        const selected = state.items[index];
        // Compare the clicked card's full identity to the current page.
        // Index-only navigation may otherwise open a different person's video.
        if (
          !selected ||
          (expectedVideo && (
            selected.id !== expectedVideo.id ||
            selected.ownerUid !== expectedVideo.ownerUid
          ))
        ) {
          return EMPTY;
        }

        this.viewerOpening.set(true);
        this.openingVideoId.set(selected.id);

        return this.videoViewerLauncher.open$({
          items: state.items,
          startIndex: index,
          source: 'profile',
          profileContinuationCursor: this.galleryCursor,
        }).pipe(
          catchError((error: unknown) => {
            this.mediaError.report(error, {
              operation: 'openPublicVideoViewer',
              reasonHint: 'video_playback_access_failed',
              metadata: {
                scope: 'PublicProfileVideosComponent',
                hasOwnerUid: !!selected.ownerUid,
                hasVideoId: !!selected.id,
              },
            });
            return EMPTY;
          }),
          finalize(() => {
            if (this.openingVideoId() === selected.id) {
              this.openingVideoId.set(null);
            }
            this.viewerOpening.set(false);
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  shareVideo(item: IPublicVideoItem): void {
    if (!item?.id || this.sharingVideoId()) {
      return;
    }

    this.sharingVideoId.set(item.id);

    defer(() => from(this.publicVideoShare.sharePublicVideo(item))).pipe(
      catchError((error: unknown) => {
        this.mediaError.report(error, {
          operation: 'sharePublicVideo',
          reasonHint: 'media_share_dialog_failed',
          metadata: {
            scope: 'PublicProfileVideosComponent',
            hasOwnerUid: !!item.ownerUid,
            hasVideoId: !!item.id,
          },
        });
        return EMPTY;
      }),
      finalize(() => {
        if (this.sharingVideoId() === item.id) {
          this.sharingVideoId.set(null);
        }
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  trackByVideoId(_index: number, item: IPublicVideoItem): string {
    return this.posterKey(item);
  }

  hasUsablePoster(item: IPublicVideoItem): boolean {
    return !!item.posterUrl?.trim() &&
      !this.failedPosterKeys().has(this.posterKey(item));
  }

  isVideoOpening(item: IPublicVideoItem): boolean {
    return this.openingVideoId() === item.id;
  }

  isVideoSharing(item: IPublicVideoItem): boolean {
    return this.sharingVideoId() === item.id;
  }

  onPosterError(item: IPublicVideoItem): void {
    const key = this.posterKey(item);

    if (!key || this.failedPosterKeys().has(key)) {
      return;
    }

    this.failedPosterKeys.update((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });

    this.reportSilent(
      new Error('Falha ao carregar a capa de um vídeo público.'),
      {
        op: 'loadPublicVideoPoster',
        hasOwnerUid: !!item.ownerUid,
        hasVideoId: !!item.id,
      }
    );
  }

  formatDuration(durationMs: number | null | undefined): string {
    const totalSeconds = Math.max(
      0,
      Math.floor(Number(durationMs ?? 0) / 1000)
    );

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return 'Vídeo';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [hours, minutes, seconds]
        .map((value, position) =>
          position === 0 ? String(value) : String(value).padStart(2, '0')
        )
        .join(':');
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  formatViews(value: number | null | undefined): string {
    const views = Number(value ?? 0);
    const normalized = Number.isFinite(views) && views > 0
      ? Math.trunc(views)
      : 0;

    return `${normalized.toLocaleString('pt-BR')} ${
      normalized === 1 ? 'visualização' : 'visualizações'
    }`;
  }

  getVideoAriaLabel(
    item: IPublicVideoItem,
    index: number,
    total: number
  ): string {
    const title = item.title?.trim() || item.alt?.trim() || 'vídeo público';

    if (this.isVideoOpening(item)) {
      return `Abrindo ${title}.`;
    }

    return `Abrir ${title}. Vídeo ${index + 1} de ${total}.`;
  }

  getShareAriaLabel(item: IPublicVideoItem): string {
    const title = item.title?.trim() || item.alt?.trim() || 'vídeo público';

    return this.isVideoSharing(item)
      ? `Compartilhando ${title}.`
      : `Compartilhar ${title}.`;
  }

  private watchRequestedVideo(): void {
    if (this.deepLinkWatcherStarted) {
      return;
    }

    this.deepLinkWatcherStarted = true;

    combineLatest([this.galleryRoute$, this.state$]).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([route, state]) => {
      const { ownerUid, requestedVideoId: videoId } = route;
      const routeKey = routeIdentity(route);
      if (routeKey !== this.lastRequestedRouteIdentity) {
        this.lastRequestedRouteIdentity = routeKey;
        this.deepLinkRouteGeneration += 1;
        this.autoOpenedVideoKeys.clear();
      }

      // A router change can arrive before the state$ emission for that route.
      // Never warn or open using a previous profile's cached state.
      if (
        !ownerUid || !videoId ||
        state.routeIdentity !== routeKey ||
        (state.status !== 'ready' && state.status !== 'empty')
      ) {
        return;
      }

      const deepLinkKey = `${ownerUid}:${videoId}`;
      if (this.autoOpenedVideoKeys.has(deepLinkKey)) {
        return;
      }

      this.autoOpenedVideoKeys.add(deepLinkKey);
      const requestedIndex = state.items.findIndex(
        (item) => item.id === videoId && item.ownerUid === ownerUid
      );

      if (requestedIndex < 0) {
        this.errorNotification.showWarning(
          'Este vídeo não está mais disponível para visitantes.'
        );
        return;
      }

      const routeGeneration = this.deepLinkRouteGeneration;
      queueMicrotask(() => {
        if (
          this.deepLinkRouteGeneration !== routeGeneration ||
          this.galleryRouteIdentity !== routeKey ||
          this.lastRequestedRouteIdentity !== routeKey
        ) {
          return;
        }
        this.openVideo(requestedIndex);
      });
    });
  }

  private resetGallery(ownerUid: string): void {
    this.galleryRevision += 1;
    this.galleryOwnerUid = ownerUid;
    this.galleryCursor = null;
    this.galleryHasMore = false;
    this.galleryPagesSubject.next([]);
    this.galleryLoadingMoreSubject.next(false);
    this.galleryRenderStartSubject.next(0);
  }

  private mergeGalleryPages(
    pages: readonly (readonly IPublicVideoItem[])[]
  ): IPublicVideoItem[] {
    const unique = new Map<string, IPublicVideoItem>();

    for (const item of pages.flat()) {
      const key = this.posterKey(item);
      if (!key || unique.has(key)) {
        continue;
      }

      unique.set(key, item);
    }

    return [...unique.values()];
  }

  private posterKey(item: IPublicVideoItem): string {
    const ownerUid = item.ownerUid?.trim() ?? '';
    const videoId = item.id?.trim() ?? '';

    return ownerUid && videoId ? `${ownerUid}:${videoId}` : '';
  }

  showEarlierWindow(): void {
    this.changeVisibleWindow(Math.max(
      0,
      this.galleryRenderStartSubject.value - PUBLIC_VIDEO_RENDER_WINDOW_STEP
    ));
  }

  showLaterWindow(): void {
    const totalItems = this.mergeGalleryPages(
      this.galleryPagesSubject.value
    ).length;
    const maxStart = Math.max(
      0,
      totalItems - PUBLIC_VIDEO_RENDER_WINDOW_MAX_ITEMS
    );
    this.changeVisibleWindow(Math.min(
      maxStart,
      this.galleryRenderStartSubject.value + PUBLIC_VIDEO_RENDER_WINDOW_STEP
    ));
  }

  private changeVisibleWindow(nextStart: number): void {
    if (nextStart === this.galleryRenderStartSubject.value) return;
    this.galleryRenderStartSubject.next(nextStart);
    // Pagination controls live after the grid. Without restoring the reading
    // origin, keyboard and touch users remain below the newly mounted cards.
    // The grid node remains stable while only its cards are windowed.
    const grid = this.videoGallery?.nativeElement;
    if (!grid) return;
    grid.focus({ preventScroll: true });
    if (typeof grid.scrollIntoView === 'function') {
      grid.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }

  private buildState(
    status: PublicProfileVideosState['status'],
    items: IPublicVideoItem[],
    hasMore = false,
    loadingMore = false,
    requestedRenderStart = 0
  ): PublicProfileVideosState {
    const maxStart = Math.max(
      0,
      items.length - PUBLIC_VIDEO_RENDER_WINDOW_MAX_ITEMS
    );
    const renderStart = Math.max(
      0,
      Math.min(requestedRenderStart, maxStart)
    );
    const renderItems = items.slice(
      renderStart,
      renderStart + PUBLIC_VIDEO_RENDER_WINDOW_MAX_ITEMS
    );

    return {
      status,
      items,
      renderItems,
      renderStart,
      hasEarlierRenderWindow: renderStart > 0,
      hasLaterRenderWindow: renderStart + renderItems.length < items.length,
      hasMore,
      loadingMore,
      routeIdentity: this.galleryRouteIdentity,
    };
  }

  private reportError(
    error: unknown,
    ownerUid: string,
    requestedVideoId: string | null = null
  ): void {
    this.mediaError.report(error, {
      operation: requestedVideoId
        ? 'loadPublicVideoDeepLink'
        : 'loadPublicProfileVideos',
      reasonHint: requestedVideoId
        ? 'video_playback_access_failed'
        : 'media_discovery_load_failed',
      metadata: {
        scope: 'PublicProfileVideosComponent',
        hasOwnerUid: !!ownerUid,
        hasVideoId: !!requestedVideoId,
      },
    });
  }

  private reportSilent(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    this.mediaError.reportSilently(
      error,
      String(context['op'] ?? 'unknown'),
      undefined,
      {
        scope: 'PublicProfileVideosComponent',
        ...context,
      },
      'media_discovery_load_failed'
    );
  }

}
