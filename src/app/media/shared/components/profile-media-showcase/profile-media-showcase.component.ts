import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
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
import { MediaApplicationErrorService } from 'src/app/core/services/media/media-application-error.service';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';
import {
  IPublicProfileMediaPreview,
  MediaPublicPreviewQueryService,
} from 'src/app/core/services/media/media-public-preview-query.service';
import { ProfileMediaShowcaseViewerFacade } from './profile-media-showcase-viewer.facade';

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
  imports: [CommonModule, RouterModule, ContentStateComponent],
  templateUrl: './profile-media-showcase.component.html',
  styleUrls: [
    './profile-media-showcase.component.css',
    './profile-media-showcase-video.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ProfileMediaShowcaseViewerFacade],
})
export class ProfileMediaShowcaseComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly mediaPublicPreview = inject(MediaPublicPreviewQueryService);
  private readonly mediaError = inject(MediaApplicationErrorService);
  private readonly viewerFacade = inject(ProfileMediaShowcaseViewerFacade);

  readonly ownerUid = input.required<string>();
  readonly profileName = input('Perfil');
  readonly viewerOpening = this.viewerFacade.opening;

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
        catchError((error: unknown) => {
          this.mediaError.report(error, {
            operation: 'loadProfileMediaPreview',
            reasonHint: 'media_discovery_load_failed',
            metadata: {
              scope: 'ProfileMediaShowcaseComponent',
              hasOwnerUid: !!ownerUid,
            },
          });

          return of(this.buildState('error'));
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  openMedia(
    item: IPublicProfileMediaItem,
    fallbackIndex: number
  ): void {
    this.viewerFacade
      .open$(
        (this.ownerUid() ?? '').trim(),
        item,
        fallbackIndex
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
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
    return this.viewerFacade.identity(item);
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


}
