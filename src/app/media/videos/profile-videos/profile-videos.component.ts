// src/app/media/videos/profile-videos/profile-videos.component.ts
// -----------------------------------------------------------------------------
// Tela base de vídeos privados.
//
// Esta etapa deixa o domínio engatilhado sem expor publicação pública.
// -----------------------------------------------------------------------------

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, switchMap } from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { VideoLibraryService } from 'src/app/core/services/media/video-library.service';
import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';

@Component({
  selector: 'app-profile-videos',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './profile-videos.component.html',
  styleUrls: ['./profile-videos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileVideosComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly videoLibrary = inject(VideoLibraryService);

  readonly viewerUid$: Observable<string | null> = this.currentUserStore.user$.pipe(
    map((user) => user?.uid ?? null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly ownerUid$: Observable<string> = combineLatest([
    this.route.paramMap.pipe(
      map((params) => params.get('id')),
      distinctUntilChanged()
    ),
    this.viewerUid$,
  ]).pipe(
    map(([routeUid, viewerUid]) => routeUid ?? viewerUid ?? ''),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isOwner$: Observable<boolean> = combineLatest([
    this.viewerUid$,
    this.ownerUid$,
  ]).pipe(
    map(([viewerUid, ownerUid]) => !!viewerUid && viewerUid === ownerUid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly videos$: Observable<IVideoItem[]> = combineLatest([
    this.ownerUid$,
    this.isOwner$,
  ]).pipe(
    switchMap(([ownerUid, isOwner]) =>
      ownerUid && isOwner
        ? this.videoLibrary.watchPrivateVideos$(ownerUid)
        : of([])
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  trackByVideoId(_index: number, item: IVideoItem): string {
    return item.id;
  }

  formatFileSize(sizeBytes: number | null | undefined): string {
    const size = Number(sizeBytes ?? 0);

    if (!Number.isFinite(size) || size <= 0) {
      return 'Tamanho não informado';
    }

    if (size < 1024 * 1024) {
      return `${Math.round(size / 1024)} KB`;
    }

    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
}
