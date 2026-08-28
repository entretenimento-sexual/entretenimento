import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
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
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import {
  IPublicProfileMediaItem,
  isPublicPhotoItem,
  isPublicVideoItem,
} from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  IPublicProfileMediaPreview,
  MediaPublicPreviewQueryService,
} from 'src/app/core/services/media/media-public-preview-query.service';
import { PublicMixedMediaViewerLauncherService } from '../../services/public-mixed-media-viewer-launcher.service';

type ProfileMediaShowcaseStatus = 'loading' | 'ready' | 'empty' | 'error';

interface ProfileMediaShowcaseState {
  status: ProfileMediaShowcaseStatus;
  items: IPublicProfileMediaItem[];
  photosCount: number;
  videosCount: number;
  totalCount: number;
}

const SHOWCASE_ITEM_LIMIT = 5;

@Component({
  selector: 'app-profile-media-showcase',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './profile-media-showcase.component.html',
  styleUrls: [
    './profile-media-showcase.component.css',
    './profile-media-showcase-video.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileMediaShowcaseComponent {
  private readonly mediaPublicPreview = inject(MediaPublicPreviewQueryService);
  private readonly mixedViewerLauncher = inject(PublicMixedMediaViewerLauncherService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  readonly ownerUid = input.required<string>();
  readonly profileName = input('Perfil');
  readonly viewerOpening = signal(false);

  private readonly refreshSubject = new BehaviorSubject<number>(0);
  private readonly ownerUid$ = toObservable(this.ownerUid).pipe(
    map((uid) => (uid ?? '').trim()),
    distinctUntilChanged()
  );

  readonly photoGalleryLink = computed(() => [
    '/media',
    'perfil',
    (this.ownerUid() ?? '').trim(),
    'fotos-publicas',
  ]);

  readonly state$: Observable<ProfileMediaShowcaseState> = combineLatest([
    this.ownerUid$,
    this.refreshSubject,
  ]).pipe(
    switchMap(([ownerUid]) => {
      if (!ownerUid) {
        return of(this.buildState('empty'));
      }

      return this.mediaPublicPreview.getProfilePublicMediaPreview$(
        ownerUid,
        SHOWCASE_ITEM_LIMIT,
        { propagateErrors: true }
      ).pipe(
        map((preview) => this.buildState(
          preview.items.length > 0 ? 'ready' : 'empty',
          preview
        )),
        startWith(this.buildState('loading')),
        catchError(() => {
          this.errorNotification.showError(
            'Não foi possível carregar as mídias deste perfil agora.'
          );

          return of(this.buildState('error'));
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  async openMedia(
    item: IPublicProfileMediaItem,
    fallbackIndex: number
  ): Promise<void> {
    const ownerUid = (this.ownerUid() ?? '').trim();
    const mediaId = (item.id ?? '').trim();

    if (!ownerUid || !mediaId || this.viewerOpening()) {
      return;
    }

    this.viewerOpening.set(true);

    let preview: IPublicProfileMediaPreview;

    try {
      preview = await firstValueFrom(
        this.mediaPublicPreview.getProfilePublicMediaPreview$(
          ownerUid,
          SHOWCASE_ITEM_LIMIT,
          { propagateErrors: true }
        )
      );
    } catch {
      this.errorNotification.showError(
        'Não foi possível atualizar o acesso às mídias deste perfil.'
      );
      this.viewerOpening.set(false);
      return;
    }

    const items = [...preview.items];
    const selectedIdentity = this.buildMediaIdentity(item);
    const refreshedIndex = items.findIndex(
      (candidate) => this.buildMediaIdentity(candidate) === selectedIdentity
    );
    const safeFallbackIndex = Math.max(
      0,
      Math.min(fallbackIndex, Math.max(0, items.length - 1))
    );
    const fallbackItem = items[safeFallbackIndex] ?? null;
    const refreshedItem = refreshedIndex >= 0
      ? items[refreshedIndex]
      : fallbackItem && this.buildMediaIdentity(fallbackItem) === selectedIdentity
        ? fallbackItem
        : null;

    if (!refreshedItem) {
      this.errorNotification.showWarning(
        'Esta mídia não está mais disponível para visitantes.'
      );
      this.viewerOpening.set(false);
      return;
    }

    try {
      await firstValueFrom(this.mixedViewerLauncher.open$({
        items,
        selected: refreshedItem,
        source: 'profile',
      }));
    } catch (error) {
      this.reportViewerError(error, ownerUid, refreshedItem);
      this.errorNotification.showError(
        'Não foi possível abrir a visualização imersiva.'
      );
    } finally {
      this.viewerOpening.set(false);
    }
  }

  visibleItems(
    items: readonly IPublicProfileMediaItem[]
  ): readonly IPublicProfileMediaItem[] {
    return items.slice(0, SHOWCASE_ITEM_LIMIT);
  }

  remainingCount(total: number): number {
    return Math.max(0, total - SHOWCASE_ITEM_LIMIT);
  }

  trackByMediaId(
    _index: number,
    item: IPublicProfileMediaItem
  ): string {
    return this.buildMediaIdentity(item);
  }

  isVideo(item: IPublicProfileMediaItem): item is IPublicVideoItem {
    return isPublicVideoItem(item);
  }

  isCover(item: IPublicProfileMediaItem): boolean {
    return isPublicPhotoItem(item) && item.isCover === true;
  }

  getMediaAriaLabel(
    item: IPublicProfileMediaItem,
    index: number,
    total: number
  ): string {
    const position = `${index + 1} de ${total}`;
    const mediaType = this.isVideo(item) ? 'vídeo' : 'foto';
    const label = item.alt?.trim() ||
      `${mediaType} publicada por ${this.profileName()}`;

    return `Abrir ${label}. Mídia ${position}.`;
  }

  formatDuration(durationMs: number | null | undefined): string {
    const totalSeconds = Math.max(0, Math.floor(Number(durationMs ?? 0) / 1000));

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return 'Vídeo';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return [hours, minutes, seconds]
        .map((value, position) => position === 0
          ? String(value)
          : String(value).padStart(2, '0'))
        .join(':');
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  private buildState(
    status: ProfileMediaShowcaseStatus,
    preview: IPublicProfileMediaPreview | null = null
  ): ProfileMediaShowcaseState {
    return {
      status,
      items: [...(preview?.items ?? [])],
      photosCount: preview?.photosCount ?? 0,
      videosCount: preview?.videosCount ?? 0,
      totalCount: preview?.totalCount ?? 0,
    };
  }

  private buildMediaIdentity(item: IPublicProfileMediaItem): string {
    return `${this.isVideo(item) ? 'VIDEO' : 'PHOTO'}:${item.id}`;
  }

  private reportViewerError(
    error: unknown,
    ownerUid: string,
    item: IPublicProfileMediaItem
  ): void {
    try {
      const normalizedError = error instanceof Error
        ? error
        : new Error('Falha ao carregar o visualizador de mídia.');

      (normalizedError as any).original = error;
      (normalizedError as any).context = {
        scope: 'ProfileMediaShowcaseComponent',
        op: 'openMedia.viewer',
        mediaType: this.isVideo(item) ? 'VIDEO' : 'PHOTO',
        hasOwnerUid: !!ownerUid,
        hasMediaId: !!item.id,
      };
      (normalizedError as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
