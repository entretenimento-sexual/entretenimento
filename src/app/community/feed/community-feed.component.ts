// src/app/community/feed/community-feed.component.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED
// -----------------------------------------------------------------------------
// Mural e galeria somente leitura. O componente é instanciado apenas depois que
// a página comunitária foi autorizada pela callable de prévia.
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
  combineLatest,
  catchError,
  exhaustMap,
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
import {
  CommunityFeedItem,
  CommunityFeedPage,
  CommunityFeedView,
} from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';

export type CommunityFeedStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface CommunityFeedState {
  status: CommunityFeedStatus;
  items: readonly CommunityFeedItem[];
  nextCursor: string | null;
  loadingMore: boolean;
}

interface CommunityFeedLoadRequest {
  cursor: string | null;
  append: boolean;
}

type CommunityFeedLoadEvent =
  | { type: 'loading'; request: CommunityFeedLoadRequest }
  | { type: 'success'; request: CommunityFeedLoadRequest; page: CommunityFeedPage }
  | { type: 'error'; request: CommunityFeedLoadRequest };

export const INITIAL_COMMUNITY_FEED_STATE: CommunityFeedState = Object.freeze({
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
});

function mergeUniqueItems(
  currentItems: readonly CommunityFeedItem[],
  incomingItems: readonly CommunityFeedItem[]
): readonly CommunityFeedItem[] {
  const merged = new Map<string, CommunityFeedItem>();

  for (const item of currentItems) merged.set(item.postId, item);
  for (const item of incomingItems) merged.set(item.postId, item);

  return [...merged.values()];
}

export function reduceCommunityFeedState(
  state: CommunityFeedState,
  event: CommunityFeedLoadEvent
): CommunityFeedState {
  if (event.type === 'loading') {
    return event.request.append
      ? { ...state, loadingMore: true }
      : INITIAL_COMMUNITY_FEED_STATE;
  }

  if (event.type === 'error') {
    return event.request.append && state.items.length > 0
      ? { ...state, status: 'ready', loadingMore: false }
      : {
          status: 'error',
          items: [],
          nextCursor: null,
          loadingMore: false,
        };
  }

  const items = event.request.append
    ? mergeUniqueItems(state.items, event.page.items)
    : event.page.items;

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
  };
}

const relativeFormatter = new Intl.RelativeTimeFormat('pt-BR', {
  numeric: 'auto',
});

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

  readonly communityId = input.required<string>();
  readonly view = input<CommunityFeedView>('feed');

  readonly state$ = combineLatest([
    toObservable(this.communityId),
    toObservable(this.view),
  ]).pipe(
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

  emptyLabel(): string {
    return this.view() === 'photos'
      ? 'Nenhuma foto disponível.'
      : 'Nenhuma publicação disponível.';
  }

  publishedLabel(publishedAt: number): string {
    const elapsed = publishedAt - Date.now();
    const absolute = Math.abs(elapsed);

    if (absolute < 60_000) return 'agora';
    if (absolute < 3_600_000) {
      return relativeFormatter.format(Math.round(elapsed / 60_000), 'minute');
    }
    if (absolute < 86_400_000) {
      return relativeFormatter.format(Math.round(elapsed / 3_600_000), 'hour');
    }
    if (absolute < 7 * 86_400_000) {
      return relativeFormatter.format(Math.round(elapsed / 86_400_000), 'day');
    }

    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
    }).format(publishedAt);
  }

  private reportLoadError(error: unknown, view: CommunityFeedView): void {
    try {
      this.errorNotifier.showError(
        view === 'photos'
          ? 'Não foi possível carregar as fotos agora.'
          : 'Não foi possível carregar o mural agora.'
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
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
