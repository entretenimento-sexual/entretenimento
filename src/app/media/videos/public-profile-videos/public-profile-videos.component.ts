// src/app/media/videos/public-profile-videos/public-profile-videos.component.ts
// -----------------------------------------------------------------------------
// Galeria pública de vídeos aprovados de um perfil.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
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
import { ReportContentButtonComponent } from 'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component';

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
    ReportContentButtonComponent,
  ],
  templateUrl: './public-profile-videos.component.html',
  styleUrls: ['./public-profile-videos.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicProfileVideosComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  private readonly refreshSubject = new BehaviorSubject<number>(0);

  readonly viewerOpening = signal(false);

  readonly viewerUid$: Observable<string | null> =
    this.currentUserStore.user$.pipe(
      map((user) => (user as ViewerUserLike | null)?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly ownerUid$: Observable<string> = this.route.paramMap.pipe(
    map((params) => (params.get('id') ?? '').trim()),
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

  retry(): void {
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
      this.viewerOpening.set(false);
    }
  }

  trackByVideoId(_index: number, item: IPublicVideoItem): string {
    return item.id;
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
    return `Abrir ${title}. Vídeo ${index + 1} de ${total}.`;
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
        ? error
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
