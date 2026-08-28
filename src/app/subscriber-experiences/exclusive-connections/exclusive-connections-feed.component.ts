// src/app/subscriber-experiences/exclusive-connections/exclusive-connections-feed.component.ts
// -----------------------------------------------------------------------------
// EXCLUSIVE CONNECTIONS FEED
// -----------------------------------------------------------------------------
// Feed reativo, paginável e instanciado somente após autorização da página pai.
// Não mantém subscriptions imperativas e não consulta Firestore diretamente.
// -----------------------------------------------------------------------------

import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  catchError,
  exhaustMap,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  Subject,
} from 'rxjs';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import {
  ExclusiveConnectionCard,
  ExclusiveConnectionsPage,
} from './exclusive-connections.model';
import { ExclusiveConnectionsRepository } from './exclusive-connections.repository';

export type ExclusiveConnectionsFeedStatus =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error';

export interface ExclusiveConnectionsFeedState {
  status: ExclusiveConnectionsFeedStatus;
  items: readonly ExclusiveConnectionCard[];
  nextCursor: string | null;
  loadingMore: boolean;
}

interface ExclusiveConnectionsLoadRequest {
  cursor: string | null;
  append: boolean;
}

type ExclusiveConnectionsLoadEvent =
  | {
      type: 'loading';
      request: ExclusiveConnectionsLoadRequest;
    }
  | {
      type: 'success';
      request: ExclusiveConnectionsLoadRequest;
      page: ExclusiveConnectionsPage;
    }
  | {
      type: 'error';
      request: ExclusiveConnectionsLoadRequest;
    };

export const INITIAL_EXCLUSIVE_CONNECTIONS_FEED_STATE:
  ExclusiveConnectionsFeedState = Object.freeze({
    status: 'loading',
    items: [],
    nextCursor: null,
    loadingMore: false,
  });

function mergeUniqueCards(
  currentItems: readonly ExclusiveConnectionCard[],
  incomingItems: readonly ExclusiveConnectionCard[]
): readonly ExclusiveConnectionCard[] {
  const merged = new Map<string, ExclusiveConnectionCard>();

  for (const item of currentItems) {
    merged.set(item.candidateUid, item);
  }

  for (const item of incomingItems) {
    merged.set(item.candidateUid, item);
  }

  return [...merged.values()];
}

export function reduceExclusiveConnectionsFeedState(
  state: ExclusiveConnectionsFeedState,
  event: ExclusiveConnectionsLoadEvent
): ExclusiveConnectionsFeedState {
  if (event.type === 'loading') {
    return event.request.append
      ? {
          ...state,
          loadingMore: true,
        }
      : INITIAL_EXCLUSIVE_CONNECTIONS_FEED_STATE;
  }

  if (event.type === 'error') {
    return event.request.append && state.items.length > 0
      ? {
          ...state,
          status: 'ready',
          loadingMore: false,
        }
      : {
          status: 'error',
          items: [],
          nextCursor: null,
          loadingMore: false,
        };
  }

  const items = event.request.append
    ? mergeUniqueCards(state.items, event.page.items)
    : event.page.items;

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
  };
}

@Component({
  selector: 'app-exclusive-connections-feed',
  standalone: true,
  imports: [AsyncPipe, RouterLink, ImageFallbackDirective],
  templateUrl: './exclusive-connections-feed.component.html',
  styleUrl: './exclusive-connections-feed.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExclusiveConnectionsFeedComponent {
  private readonly repository = inject(ExclusiveConnectionsRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly loadRequests$ = new Subject<ExclusiveConnectionsLoadRequest>();

  readonly state$ = this.loadRequests$.pipe(
    startWith<ExclusiveConnectionsLoadRequest>({
      cursor: null,
      append: false,
    }),
    exhaustMap((request) =>
      this.repository
        .getPage$({ limit: 12, cursor: request.cursor })
        .pipe(
          map(
            (page): ExclusiveConnectionsLoadEvent => ({
              type: 'success',
              request,
              page,
            })
          ),
          startWith<ExclusiveConnectionsLoadEvent>({
            type: 'loading',
            request,
          }),
          catchError((error: unknown) => {
            this.reportLoadError(error);
            return of<ExclusiveConnectionsLoadEvent>({
              type: 'error',
              request,
            });
          })
        )
    ),
    scan(
      reduceExclusiveConnectionsFeedState,
      INITIAL_EXCLUSIVE_CONNECTIONS_FEED_STATE
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  loadMore(cursor: string | null): void {
    if (!cursor) {
      return;
    }

    this.loadRequests$.next({ cursor, append: true });
  }

  retry(): void {
    this.loadRequests$.next({ cursor: null, append: false });
  }

  private reportLoadError(error: unknown): void {
    try {
      this.errorNotifier.showError(
        'Não foi possível carregar as conexões agora.'
      );
    } catch {
      // O diagnóstico técnico abaixo continua mesmo se o feedback visual falhar.
    }

    try {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      const contextualError = normalizedError as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };

      contextualError.context = {
        scope: 'ExclusiveConnectionsFeedComponent',
        op: 'loadPage',
      };
      contextualError.skipUserNotification = true;

      this.globalError.handleError(contextualError);
    } catch {
      // Falhas secundárias de observabilidade não devem quebrar a experiência.
    }
  }
}
