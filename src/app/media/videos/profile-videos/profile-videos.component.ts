// src/app/media/videos/profile-videos/profile-videos.component.ts
// -----------------------------------------------------------------------------
// Biblioteca privada e publicação controlada de vídeos.
//
// Segurança:
// - o dono lê apenas users/{uid}/videos;
// - publicação/despublicação passa por Cloud Functions;
// - a UI nunca grava projeção pública ou caminho publicado diretamente;
// - visitantes consomem somente public_profiles/{uid}/public_videos.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  BehaviorSubject,
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
  switchMap,
  take,
} from 'rxjs/operators';

import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { IVideoPublicationConfig } from 'src/app/core/interfaces/media/i-video-publication-config';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { VideoLibraryService } from 'src/app/core/services/media/video-library.service';
import { VideoPublicationService } from 'src/app/core/services/media/video-publication.service';

interface ProfileVideoViewItem {
  video: IVideoItem;
  publication: IVideoPublicationConfig | null;
}

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
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly videoLibrary = inject(VideoLibraryService);
  private readonly videoPublication = inject(VideoPublicationService);
  private readonly errorNotification = inject(ErrorNotificationService);

  private readonly busyVideoIdsSubject = new BehaviorSubject<
    ReadonlySet<string>
  >(new Set());
  readonly busyVideoIds$ = this.busyVideoIdsSubject.asObservable();

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

  readonly viewItems$: Observable<ProfileVideoViewItem[]> = combineLatest([
    this.ownerUid$,
    this.isOwner$,
  ]).pipe(
    switchMap(([ownerUid, isOwner]) => {
      if (!ownerUid || !isOwner) {
        return of([] as ProfileVideoViewItem[]);
      }

      return combineLatest([
        this.videoLibrary.watchPrivateVideos$(ownerUid),
        this.videoPublication.watchOwnVideoPublications$(ownerUid).pipe(
          catchError(() => {
            this.errorNotification.showError(
              'Não foi possível carregar o estado de publicação dos vídeos.'
            );
            return of([] as IVideoPublicationConfig[]);
          })
        ),
      ]).pipe(
        map(([videos, publications]) => {
          const publicationByVideoId = new Map(
            publications.map((publication) => [
              publication.videoId,
              publication,
            ])
          );

          return videos.map((video) => ({
            video,
            publication: publicationByVideoId.get(video.id) ?? null,
          }));
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  publishVideo(item: ProfileVideoViewItem): void {
    if (!this.canPublish(item) || this.isBusy(item.video.id)) {
      return;
    }

    this.setBusy(item.video.id, true);

    this.ownerUid$
      .pipe(
        take(1),
        switchMap((ownerUid) =>
          this.videoPublication.publishVideo$(ownerUid, item.video.id)
        ),
        finalize(() => this.setBusy(item.video.id, false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          const message = result.moderationStatus === 'APPROVED'
            ? 'Vídeo publicado no perfil.'
            : 'Vídeo enviado para análise antes da publicação.';
          this.errorNotification.showSuccess(message);
        },
        error: () => {
          this.errorNotification.showError(
            'Não foi possível publicar este vídeo.'
          );
        },
      });
  }

  unpublishVideo(item: ProfileVideoViewItem): void {
    if (!item.publication?.isPublished || this.isBusy(item.video.id)) {
      return;
    }

    this.setBusy(item.video.id, true);

    this.ownerUid$
      .pipe(
        take(1),
        switchMap((ownerUid) =>
          this.videoPublication.unpublishVideo$(ownerUid, item.video.id)
        ),
        finalize(() => this.setBusy(item.video.id, false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.errorNotification.showSuccess(
            'Vídeo removido da área pública.'
          );
        },
        error: () => {
          this.errorNotification.showError(
            'Não foi possível remover a publicação do vídeo.'
          );
        },
      });
  }

  canPublish(item: ProfileVideoViewItem): boolean {
    return (
      !item.publication?.isPublished &&
      item.video.status !== 'processing' &&
      item.video.status !== 'failed'
    );
  }

  isBusy(videoId: string): boolean {
    return this.busyVideoIdsSubject.value.has(videoId);
  }

  publicationLabel(item: ProfileVideoViewItem): string {
    if (!item.publication?.isPublished) {
      return 'Privado';
    }

    if (item.publication.moderationStatus === 'APPROVED') {
      return 'Publicado';
    }

    if (item.publication.moderationStatus === 'PENDING_REVIEW') {
      return 'Em análise';
    }

    return 'Publicação indisponível';
  }

  processingLabel(video: IVideoItem): string {
    if (video.status === 'processing') {
      return 'Processando';
    }

    if (video.status === 'failed') {
      return 'Falha no processamento';
    }

    if (video.status === 'ready') {
      return 'Pronto';
    }

    return 'Enviado';
  }

  trackByVideoId(_index: number, item: ProfileVideoViewItem): string {
    return item.video.id;
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

  formatDuration(durationMs: number | null | undefined): string {
    const totalSeconds = Math.max(0, Math.floor(Number(durationMs ?? 0) / 1000));

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
      return 'Duração não informada';
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  private setBusy(videoId: string, busy: boolean): void {
    const next = new Set(this.busyVideoIdsSubject.value);

    if (busy) {
      next.add(videoId);
    } else {
      next.delete(videoId);
    }

    this.busyVideoIdsSubject.next(next);
  }
}
