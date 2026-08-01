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
  Observable,
  combineLatest,
  firstValueFrom,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { PublicVideoShareService } from 'src/app/core/services/media/public-video-share.service';
import { ReportContentButtonComponent } from 'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component';
import { PublicVideoMetadataPreloadDirective } from '../public-video-metadata-preload.directive';

interface PublicProfileVideosState {
  status: 'loading' | 'ready' | 'empty' | 'error';
  items: IPublicVideoItem[];
}

interface ViewerUserLike {
  uid?: string | null;
}

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
  private readonly publicVideoShare = inject(PublicVideoShareService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  private readonly refreshSubject = new BehaviorSubject<number>(0);
  private readonly autoOpenedVideoKeys = new Set<string>();
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
    this.refreshSubject,
  ]).pipe(
    switchMap(([ownerUid]) => {
      if (!ownerUid) {
        return of(this.buildState('empty', []));
      }

      return this.mediaPublicQuery
        .getProfilePublicVideos$(ownerUid, { propagateErrors: true })
        .pipe(
          map((items) =>
            this.buildState(items.length > 0 ? 'ready' : 'empty', items)
          ),
          startWith(this.buildState('loading', [])),
          catchError((error: unknown) => {
            this.reportError(error, ownerUid);
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

  async openVideo(index: number): Promise<void> {
    if (this.viewerOpening()) {
      return;
    }

    const state = await firstValueFrom(this.state$);

    if (state.status !== 'ready' || !state.items.length) {
      this.errorNotification.showWarning('Nenhum vídeo público disponível.');
      return;
    }

    const safeIndex = Math.max(0, Math.min(index, state.items.length - 1));
    const selected = state.items[safeIndex];

    if (!selected) {
      return;
    }

    this.viewerOpening.set(true);
    this.openingVideoId.set(selected.id);

    try {
      const { PublicVideoViewerComponent } = await import(
        '../public-video-viewer/public-video-viewer.component'
      );

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
    } catch (error) {
      this.reportViewerError(error, selected);
      this.errorNotification.showError(
        'Não foi possível abrir o vídeo neste momento.'
      );
    } finally {
      if (this.openingVideoId() === selected.id) {
        this.openingVideoId.set(null);
      }
      this.viewerOpening.set(false);
    }
  }

  async shareVideo(item: IPublicVideoItem): Promise<void> {
    if (!item?.id || this.sharingVideoId()) {
      return;
    }

    this.sharingVideoId.set(item.id);

    try {
      await this.publicVideoShare.sharePublicVideo(item);
    } finally {
      if (this.sharingVideoId() === item.id) {
        this.sharingVideoId.set(null);
      }
    }
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
        void this.openVideo(requestedIndex);
      });
    });
  }

  private posterKey(item: IPublicVideoItem): string {
    const ownerUid = item.ownerUid?.trim() ?? '';
    const videoId = item.id?.trim() ?? '';

    return ownerUid && videoId ? `${ownerUid}:${videoId}` : '';
  }

  private buildState(
    status: PublicProfileVideosState['status'],
    items: IPublicVideoItem[]
  ): PublicProfileVideosState {
    return { status, items };
  }

  private reportError(error: unknown, ownerUid: string): void {
    this.errorNotification.showError(
      'Não foi possível carregar os vídeos públicos deste perfil.'
    );

    this.reportSilent(error, {
      op: 'loadPublicProfileVideos',
      hasOwnerUid: !!ownerUid,
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
