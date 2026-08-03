import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  IOrderableProfileVideo,
  VideoProfileOrderService,
} from 'src/app/core/services/media/video-profile-order.service';

@Component({
  selector: 'app-video-profile-order',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './video-profile-order.component.html',
  styleUrl: './video-profile-order.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoProfileOrderComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly videoOrder = inject(VideoProfileOrderService);
  private readonly errorNotification = inject(ErrorNotificationService);

  private readonly busySubject = new BehaviorSubject(false);
  readonly busy$ = this.busySubject.asObservable();

  readonly ownerUid$ = this.currentUserStore.user$.pipe(
    map((user) => user?.uid?.trim() ?? ''),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly videos$: Observable<IOrderableProfileVideo[]> = this.ownerUid$.pipe(
    switchMap((ownerUid) =>
      ownerUid
        ? this.videoOrder.watchOrderableVideos$(ownerUid)
        : of([] as IOrderableProfileVideo[])
    ),
    catchError(() => {
      this.errorNotification.showError(
        'Não foi possível carregar a ordem dos vídeos.'
      );
      return of([] as IOrderableProfileVideo[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  move(
    videos: readonly IOrderableProfileVideo[],
    index: number,
    direction: -1 | 1
  ): void {
    if (this.busySubject.value) {
      return;
    }

    const targetIndex = index + direction;

    if (index < 0 || targetIndex < 0 || targetIndex >= videos.length) {
      return;
    }

    const orderedVideoIds = videos.map((video) => video.videoId);
    [orderedVideoIds[index], orderedVideoIds[targetIndex]] = [
      orderedVideoIds[targetIndex],
      orderedVideoIds[index],
    ];

    this.busySubject.next(true);

    this.ownerUid$.pipe(
      take(1),
      switchMap((ownerUid) =>
        this.videoOrder.reorder$(ownerUid, orderedVideoIds)
      ),
      finalize(() => this.busySubject.next(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        this.errorNotification.showSuccess(
          result.unchanged
            ? 'A ordem já estava atualizada.'
            : 'Ordem dos vídeos atualizada no perfil.'
        );
      },
      error: () => {
        this.errorNotification.showError(
          'Não foi possível alterar a ordem. Atualize a página e tente novamente.'
        );
      },
    });
  }

  trackByVideoId(
    _index: number,
    video: IOrderableProfileVideo
  ): string {
    return video.videoId;
  }
}
