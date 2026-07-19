// src/app/community/feed/community-feed.component.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED
// -----------------------------------------------------------------------------
// Mural comunitário, novidades de Local e galeria somente leitura, carregados
// apenas após a prévia autorizada.
// -----------------------------------------------------------------------------

import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  Subject,
  switchMap,
} from 'rxjs';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { CommunityFeedView } from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityPreviewSourceType } from '../data-access/community-preview.model';
import {
  CommunityFeedLoadEvent,
  CommunityFeedLoadRequest,
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed-state.model';
import {
  formatCommunityFeedIso,
  formatCommunityFeedTime,
} from './community-feed-time.util';

export {
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed-state.model';

@Component({
  selector: 'app-community-feed',
  standalone: true,
  imports: [AsyncPipe, ImageFallbackDirective],
  templateUrl: './community-feed.component.html',
  styleUrl: './community-feed.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityFeedComponent {
  private readonly repository = inject(CommunityFeedRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly loadRequests$ = new Subject<CommunityFeedLoadRequest>();

  readonly communityId = input<string>('');
  readonly view = input<CommunityFeedView>('feed');
  readonly sourceType = input<CommunityPreviewSourceType>('community');

  readonly state$ = combineLatest([
    toObservable(this.communityId),
    toObservable(this.view),
  ]).pipe(
    map(([communityId, view]) => [communityId.trim(), view] as const),
    filter(([communityId]) => communityId.length > 0),
    distinctUntilChanged(
      ([previousId, previousView], [currentId, currentView]) =>
        previousId === currentId && previousView === currentView
    ),
    switchMap(([communityId, view]) =>
      this.loadRequests$.pipe(
        startWith<CommunityFeedLoadRequest>({ cursor: null, append: false }),
        exhaustMap((request) =>
          this.repository
            .getPage$({
              communityId,
              view,
              limit: 10,
              cursor: request.cursor,
            })
            .pipe(
              map(
                (page): CommunityFeedLoadEvent => ({
                  type: 'success',
                  request,
                  page,
                })
              ),
              startWith<CommunityFeedLoadEvent>({
                type: 'loading',
                request,
              }),
              catchError((error: unknown) => {
                this.reportLoadError(error, view);
                return of<CommunityFeedLoadEvent>({ type: 'error', request });
              })
            )
        ),
        scan(reduceCommunityFeedState, INITIAL_COMMUNITY_FEED_STATE)
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  loadMore(cursor: string | null): void {
    if (cursor) this.loadRequests$.next({ cursor, append: true });
  }

  retry(): void {
    this.loadRequests$.next({ cursor: null, append: false });
  }

  sectionAriaLabel(): string {
    if (this.view() === 'photos') {
      return this.sourceType() === 'venue'
        ? 'Fotos do Local'
        : 'Fotos da Comunidade';
    }

    return this.sourceType() === 'venue'
      ? 'Novidades do Local'
      : 'Mural da Comunidade';
  }

  loadingLabel(): string {
    if (this.view() === 'photos') return 'Carregando fotos...';
    return this.sourceType() === 'venue'
      ? 'Carregando novidades...'
      : 'Carregando mural...';
  }

  errorStateLabel(): string {
    if (this.view() === 'photos') return 'Não foi possível carregar as fotos.';
    return this.sourceType() === 'venue'
      ? 'Não foi possível carregar as novidades.'
      : 'Não foi possível carregar o mural.';
  }

  emptyLabel(): string {
    if (this.view() === 'photos') return 'Nenhuma foto publicada.';
    return this.sourceType() === 'venue'
      ? 'Nenhuma novidade publicada.'
      : 'Nenhuma publicação no mural.';
  }

  publishedIso(publishedAt: number): string {
    return formatCommunityFeedIso(publishedAt);
  }

  publishedLabel(publishedAt: number): string {
    return formatCommunityFeedTime(publishedAt);
  }

  private reportLoadError(error: unknown, view: CommunityFeedView): void {
    try {
      this.errorNotifier.showError(
        view === 'photos'
          ? 'Não foi possível carregar as fotos agora.'
          : this.sourceType() === 'venue'
            ? 'Não foi possível carregar as novidades do Local agora.'
            : 'Não foi possível carregar o mural da Comunidade agora.'
      );
    } catch {
      // O diagnóstico técnico abaixo permanece ativo.
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityFeedComponent',
        op: 'loadPage',
        view,
        sourceType: this.sourceType(),
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
