// src/app/media/videos/public-profile-videos/public-profile-videos.component.ts
// -----------------------------------------------------------------------------
// Galeria pública de vídeos aprovados de um perfil.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
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
  filter,
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
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import {
  IPublicProfileVideoCursor,
  PublicProfileVideoPaginationService,
} from 'src/app/core/services/media/public-profile-video-pagination.service';
import { PublicVideoShareService } from 'src/app/core/services/media/public-video-share.service';
import { ReportContentButtonComponent } from 'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component';
import { PublicVideoMetadataPreloadDirective } from '../public-video-metadata-preload.directive';

interface PublicProfileVideosState {
  status: 'loading' | 'ready' | 'empty' | 'error';
  items: IPublicVideoItem[];
  hasMore: boolean;
  loadingMore: boolean;
}

interface ViewerUserLike {
  uid?: string | null;
}

const PUBLIC_VIDEO_GALLERY_PAGE_SIZE = 12;

@Component({
  selector: 'app-public-profile-videos',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatDialogModule,
    PublicVideoMetadataPreloadDirective,
    ReportContentButtonComponent,
  ],
  templateUrl: './public-profile-videos.component.html',
  styleUrls: ['./public-profile-videos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicProfileVideosComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly videoPagination = inject(PublicProfileVideoPaginationService);
  private readonly publicVideoShare = inject(PublicVideoShareService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  private readonly refreshSubject = new BehaviorSubject<number>(0);
  private readonly galleryPagesSubject = new BehaviorSubject<
    readonly (readonly IPublicVideoItem[])[]
  >([]);
  private readonly galleryLoadingMoreSubject = new BehaviorSubject<boolean>(false);
  private readonly autoOpenedVideoKeys = new Set<string>();
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

  readonly ownerUid$: Observable<string> = this.route.paramMap.pipe(
    map((params) =>
      (params.get('id') ?? params.get('ownerUid') ?? '').trim()
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly requestedVideoId$: Observable<string> = this.route.paramMap.pipe(
    map((params) => (params.get('videoId') ?? '').trim()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$: Observable<PublicProfileVideosState> = combineLatest([
    this.ownerUid$,
    this.requestedVideoId$,
    this.refreshSubject,
  ]).pipe(
    switchMap(([ownerUid, requestedVideoId]) => {
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
          ]).pipe(
            map(([pages, loadingMore]) => {
              const items = this.mergeGalleryPages(pages);

              return this.buildState(
                items.length > 0 ? 'ready' : 'empty',
                items,
                this.galleryHasMore,
                loadingMore
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
        this.galleryPagesSubject.next([
          ...this.galleryPagesSubject.value,
          page.items,
        ]);
      }),
      catchError((error: unknown) => {
        if (
          this.galleryOwnerUid === ownerUid &&
          this.galleryRevision === revision
        ) {
          this.errorNotification.showError(
            'Não foi possível carregar mais vídeos agora.'
          );
          this.reportSilent(error, {
            op: 'loadMorePublicProfileVideos',
            hasOwnerUid: true,
            hasCursor: true,
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

  openVideo(index: number): void {
    if (this.viewerOpening()) {
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

        const safeIndex = Math.max(
          0,
          Math.min(index, state.items.length - 1)
        );
        const selected = state.items[safeIndex];

        if (!selected) {
          return EMPTY;
        }

        this.viewerOpening.set(true);
        this.openingVideoId.set(selected.id);

        return from(
          import('../public-video-viewer/public-video-viewer.component')
        ).pipe(
          tap(({ PublicVideoViewerComponent }) => {
            this.dialog.open(PublicVideoViewerComponent, {
              data: {
                ownerUid: selected.ownerUid,
                items: state.items,
                startIndex: safeIndex,
                source: 'profile',
              },
              autoFocus: false,
              restoreFocus: true,
              width: '100vw',
              height: '100vh',
              maxWidth: '100vw',
              maxHeight: '100vh',
              panelClass: [
                'photo-viewer-dialog--immersive',
                'public-video-viewer-dialog',
              ],
              backdropClass: 'photo-viewer-backdrop',
            });
          }),
          catchError((error: unknown) => {
            this.reportViewerError(error, selected);
            this.errorNotification.showError(
              'Não foi possível abrir o vídeo neste momento.'
            );
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
        this.reportSilent(error, {
          op: 'sharePublicVideo',
          hasOwnerUid: !!item.ownerUid,
          hasVideoId: !!item.id,
        });
        this.errorNotification.showError(
          'Não foi possível compartilhar este vídeo agora.'
        );
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
    return item.id;
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

    combineLatest([
      this.ownerUid$,
      this.requestedVideoId$,
      this.state$,
    ]).pipe(
      filter(([, videoId, state]) =>
        !!videoId && (state.status === 'ready' || state.status === 'empty')
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([ownerUid, videoId, state]) => {
      const deepLinkKey = `${ownerUid}:${videoId}`;

      if (!ownerUid || this.autoOpenedVideoKeys.has(deepLinkKey)) {
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

      queueMicrotask(() => {
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

  private buildState(
    status: PublicProfileVideosState['status'],
    items: IPublicVideoItem[],
    hasMore = false,
    loadingMore = false
  ): PublicProfileVideosState {
    return { status, items, hasMore, loadingMore };
  }

  private reportError(
    error: unknown,
    ownerUid: string,
    requestedVideoId: string | null = null
  ): void {
    this.errorNotification.showError(
      requestedVideoId
        ? 'Não foi possível carregar este vídeo público.'
        : 'Não foi possível carregar os vídeos públicos deste perfil.'
    );

    this.reportSilent(error, {
      op: requestedVideoId
        ? 'loadPublicVideoDeepLink'
        : 'loadPublicProfileVideos',
      hasOwnerUid: !!ownerUid,
      hasVideoId: !!requestedVideoId,
    });
  }

  private reportViewerError(error: unknown, item: IPublicVideoItem): void {
    this.reportSilent(error, {
      op: 'openPublicVideoViewer',
      hasOwnerUid: !!item.ownerUid,
      hasVideoId: !!item.id,
    });
  }

  private reportSilent(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    try {
      const normalized = error instanceof Error
        ? new Error(error.message)
        : new Error('Falha na galeria pública de vídeos.');

      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PublicProfileVideosComponent',
        ...context,
      };
      (normalized as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
