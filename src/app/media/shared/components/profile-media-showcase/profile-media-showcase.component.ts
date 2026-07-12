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
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
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
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import type { IProfilePhotoItem } from '../../../photos/photo-viewer/photo-viewer.component';

 type ProfileMediaShowcaseStatus = 'loading' | 'ready' | 'empty' | 'error';

interface ProfileMediaShowcaseState {
  status: ProfileMediaShowcaseStatus;
  items: IPublicProfileMediaItem[];
  photosCount: number;
  videosCount: number;
}

const SHOWCASE_ITEM_LIMIT = 5;

@Component({
  selector: 'app-profile-media-showcase',
  standalone: true,
  imports: [CommonModule, RouterModule, MatDialogModule],
  templateUrl: './profile-media-showcase.component.html',
  styleUrls: ['./profile-media-showcase.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileMediaShowcaseComponent {
  private readonly dialog = inject(MatDialog);
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
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
        return of(this.buildState('empty', []));
      }

      return this.mediaPublicQuery.getProfilePublicMedia$(ownerUid, {
        propagateErrors: true,
      }).pipe(
        map((items) => this.buildState(
          items.length > 0 ? 'ready' : 'empty',
          items
        )),
        startWith(this.buildState('loading', [])),
        catchError(() => {
          this.errorNotification.showError(
            'Não foi possível carregar as mídias deste perfil agora.'
          );

          return of(this.buildState('error', []));
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

    let items: IPublicProfileMediaItem[];

    try {
      items = await firstValueFrom(
        this.mediaPublicQuery.getProfilePublicMedia$(ownerUid, {
          propagateErrors: true,
        })
      );
    } catch {
      this.errorNotification.showError(
        'Não foi possível atualizar o acesso às mídias deste perfil.'
      );
      this.viewerOpening.set(false);
      return;
    }

    const selectedIdentity = this.buildMediaIdentity(item);
    const refreshedIndex = items.findIndex(
      (candidate) => this.buildMediaIdentity(candidate) === selectedIdentity
    );
    const safeIndex = refreshedIndex >= 0
      ? refreshedIndex
      : Math.max(0, Math.min(fallbackIndex, items.length - 1));
    const refreshedItem = items[safeIndex] ?? null;

    if (!refreshedItem) {
      this.errorNotification.showWarning(
        'Esta mídia não está mais disponível para visitantes.'
      );
      this.viewerOpening.set(false);
      return;
    }

    try {
      if (isPublicVideoItem(refreshedItem)) {
        await this.openVideoViewer(items, refreshedItem, ownerUid);
      } else {
        await this.openPhotoViewer(items, refreshedItem, ownerUid);
      }
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
    items: IPublicProfileMediaItem[]
  ): ProfileMediaShowcaseState {
    return {
      status,
      items,
      photosCount: items.filter(isPublicPhotoItem).length,
      videosCount: items.filter(isPublicVideoItem).length,
    };
  }

  private async openPhotoViewer(
    items: IPublicProfileMediaItem[],
    selected: IPublicPhotoItem,
    ownerUid: string
  ): Promise<void> {
    const photoItems = items.filter(isPublicPhotoItem);
    const startIndex = Math.max(
      0,
      photoItems.findIndex((item) => item.id === selected.id)
    );
    const viewerItems = photoItems.map((item) => this.toViewerPhotoItem(item));
    const { PhotoViewerComponent } = await import(
      '../../../photos/photo-viewer/photo-viewer.component'
    );

    this.dialog.open(PhotoViewerComponent, {
      data: {
        ownerUid,
        items: viewerItems,
        startIndex,
        source: 'profile',
      },
      autoFocus: false,
      restoreFocus: true,
      width: '100vw',
      height: '100vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      panelClass: ['photo-viewer-dialog', 'photo-viewer-dialog--immersive'],
      backdropClass: 'photo-viewer-backdrop',
    });
  }

  private async openVideoViewer(
    items: IPublicProfileMediaItem[],
    selected: IPublicVideoItem,
    ownerUid: string
  ): Promise<void> {
    const videoItems = items.filter(isPublicVideoItem);
    const startIndex = Math.max(
      0,
      videoItems.findIndex((item) => item.id === selected.id)
    );
    const { PublicVideoViewerComponent } = await import(
      '../../../videos/public-video-viewer/public-video-viewer.component'
    );

    this.dialog.open(PublicVideoViewerComponent, {
      data: {
        ownerUid,
        items: videoItems,
        startIndex,
      },
      autoFocus: false,
      restoreFocus: true,
      width: '100vw',
      height: '100vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      panelClass: ['public-video-viewer-dialog'],
      backdropClass: 'photo-viewer-backdrop',
    });
  }

  private toViewerPhotoItem(item: IPublicPhotoItem): IProfilePhotoItem {
    return {
      id: item.id,
      ownerUid: item.ownerUid,
      url: item.url,
      alt: item.alt,
      createdAt: item.createdAt,
      commentsEnabled: item.commentsEnabled ?? false,
      commentsPolicy: item.commentsPolicy ?? 'OFF',
      reactionsEnabled: item.reactionsEnabled ?? false,
      moderationStatus: item.moderationStatus ?? 'PRIVATE',
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
