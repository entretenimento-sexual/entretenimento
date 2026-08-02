import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { finalize, take } from 'rxjs/operators';

import {
  IPublicVideoRankingCursor,
  TPublicVideoRankingMode,
} from 'src/app/core/interfaces/media/i-public-video-ranking';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicVideoRankingQueryService } from 'src/app/core/services/media/public-video-ranking-query.service';

interface PublicVideoDiscoveryState {
  readonly status: 'loading' | 'ready' | 'empty';
  readonly mode: TPublicVideoRankingMode;
  readonly items: readonly IPublicVideoItem[];
  readonly nextCursor: IPublicVideoRankingCursor | null;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
}

const PAGE_SIZE = 12;

@Component({
  selector: 'app-public-video-discovery',
  standalone: true,
  imports: [CommonModule, RouterModule, MatDialogModule],
  templateUrl: './public-video-discovery.component.html',
  styleUrls: ['./public-video-discovery.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicVideoDiscoveryComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly rankingQuery = inject(PublicVideoRankingQueryService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly errorHandler = inject(GlobalErrorHandlerService);

  private readonly stateSubject = new BehaviorSubject<PublicVideoDiscoveryState>(
    this.initialState('latest')
  );
  readonly state$ = this.stateSubject.asObservable();

  readonly openingVideoId = signal<string | null>(null);
  readonly failedPosterKeys = signal<ReadonlySet<string>>(new Set<string>());

  constructor() {
    this.loadPage('latest', null, false);
  }

  selectMode(mode: TPublicVideoRankingMode): void {
    const current = this.stateSubject.value;

    if (current.mode === mode && current.status !== 'empty') {
      return;
    }

    this.failedPosterKeys.set(new Set<string>());
    this.stateSubject.next(this.initialState(mode));
    this.loadPage(mode, null, false);
  }

  loadMore(): void {
    const current = this.stateSubject.value;

    if (
      current.loadingMore ||
      !current.hasMore ||
      !current.nextCursor
    ) {
      return;
    }

    this.stateSubject.next({ ...current, loadingMore: true });
    this.loadPage(current.mode, current.nextCursor, true);
  }

  retry(): void {
    const mode = this.stateSubject.value.mode;
    this.failedPosterKeys.set(new Set<string>());
    this.stateSubject.next(this.initialState(mode));
    this.loadPage(mode, null, false);
  }

  async openVideo(index: number): Promise<void> {
    const state = this.stateSubject.value;
    const item = state.items[index];

    if (!item || this.openingVideoId()) {
      return;
    }

    this.openingVideoId.set(item.id);

    try {
      const { PublicVideoViewerComponent } = await import(
        '../public-video-viewer/public-video-viewer.component'
      );

      this.dialog.open(PublicVideoViewerComponent, {
        data: {
          ownerUid: item.ownerUid,
          items: state.items,
          startIndex: index,
          source: state.mode,
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
      this.reportError(error, 'openVideo', item);
      this.errorNotification.showError(
        'Não foi possível abrir o vídeo neste momento.'
      );
    } finally {
      if (this.openingVideoId() === item.id) {
        this.openingVideoId.set(null);
      }
    }
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
  }

  hasPoster(item: IPublicVideoItem): boolean {
    return !!item.posterUrl?.trim() &&
      !this.failedPosterKeys().has(this.posterKey(item));
  }

  ownerLabel(item: IPublicVideoItem): string {
    return item.owner?.nickname?.trim() || 'Perfil';
  }

  formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  formatViews(viewsCount: number): string {
    const count = Math.max(0, Math.floor(viewsCount));
    return count === 1 ? '1 visualização' : `${count} visualizações`;
  }

  trackByVideoId(_index: number, item: IPublicVideoItem): string {
    return `${item.ownerUid}:${item.id}`;
  }

  private loadPage(
    mode: TPublicVideoRankingMode,
    cursor: IPublicVideoRankingCursor | null,
    append: boolean
  ): void {
    this.rankingQuery.loadPage$({
      mode,
      pageSize: PAGE_SIZE,
      cursor,
      notifyOnError: true,
    }).pipe(
      take(1),
      finalize(() => {
        const current = this.stateSubject.value;
        if (current.loadingMore) {
          this.stateSubject.next({ ...current, loadingMore: false });
        }
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (page) => {
        const current = this.stateSubject.value;

        if (current.mode !== mode) {
          return;
        }

        const items = append
          ? this.mergeUnique(current.items, page.items)
          : [...page.items];

        this.stateSubject.next({
          status: items.length > 0 ? 'ready' : 'empty',
          mode,
          items,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          loadingMore: false,
        });
      },
      error: (error: unknown) => {
        this.reportError(error, 'loadPage');
        const current = this.stateSubject.value;
        this.stateSubject.next({
          ...current,
          status: current.items.length > 0 ? 'ready' : 'empty',
          loadingMore: false,
        });
      },
    });
  }

  private mergeUnique(
    previous: readonly IPublicVideoItem[],
    incoming: readonly IPublicVideoItem[]
  ): IPublicVideoItem[] {
    const byKey = new Map<string, IPublicVideoItem>();

    for (const item of [...previous, ...incoming]) {
      byKey.set(`${item.ownerUid}:${item.id}`, item);
    }

    return [...byKey.values()];
  }

  private initialState(
    mode: TPublicVideoRankingMode
  ): PublicVideoDiscoveryState {
    return {
      status: 'loading',
      mode,
      items: [],
      nextCursor: null,
      hasMore: false,
      loadingMore: false,
    };
  }

  private posterKey(item: IPublicVideoItem): string {
    return `${item.ownerUid}:${item.id}:${item.posterUrl ?? ''}`;
  }

  private reportError(
    error: unknown,
    op: string,
    item?: IPublicVideoItem
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Erro na descoberta pública de vídeos.');
      (normalized as any).original = error;
      (normalized as any).context = {
        scope: 'PublicVideoDiscoveryComponent',
        op,
        hasOwnerUid: !!item?.ownerUid,
        hasVideoId: !!item?.id,
      };
      (normalized as any).skipUserNotification = true;
      this.errorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }
}
