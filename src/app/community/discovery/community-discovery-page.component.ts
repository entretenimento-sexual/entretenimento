// src/app/community/discovery/community-discovery-page.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
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

import { getSocialSpaceDefinition } from 'src/app/core/domain/social-space.definition';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import {
  CommunityDiscoveryPage,
  CommunityPreviewCard,
  CommunityPreviewSourceType,
} from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';

type CommunityDiscoveryStatus = 'loading' | 'ready' | 'empty' | 'error';

interface CommunityDiscoveryState {
  status: CommunityDiscoveryStatus;
  items: readonly CommunityPreviewCard[];
  nextCursor: string | null;
  loadingMore: boolean;
}

interface LoadRequest {
  cursor: string | null;
  append: boolean;
}

type LoadEvent =
  | { type: 'loading'; request: LoadRequest }
  | { type: 'success'; request: LoadRequest; page: CommunityDiscoveryPage }
  | { type: 'error'; request: LoadRequest };

const INITIAL_STATE: CommunityDiscoveryState = Object.freeze({
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
});

function mergeCards(
  current: readonly CommunityPreviewCard[],
  incoming: readonly CommunityPreviewCard[]
): readonly CommunityPreviewCard[] {
  const merged = new Map<string, CommunityPreviewCard>();

  for (const item of current) merged.set(item.communityId, item);
  for (const item of incoming) merged.set(item.communityId, item);

  return [...merged.values()];
}

function reduceState(
  state: CommunityDiscoveryState,
  event: LoadEvent
): CommunityDiscoveryState {
  if (event.type === 'loading') {
    return event.request.append
      ? { ...state, loadingMore: true }
      : INITIAL_STATE;
  }

  if (event.type === 'error') {
    return event.request.append && state.items.length > 0
      ? { ...state, loadingMore: false }
      : {
          status: 'error',
          items: [],
          nextCursor: null,
          loadingMore: false,
        };
  }

  const items = event.request.append
    ? mergeCards(state.items, event.page.items)
    : event.page.items;

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
  };
}

@Component({
  selector: 'app-community-discovery-page',
  standalone: true,
  imports: [
    AsyncPipe,
    RouterLink,
    RouterLinkActive,
    ImageFallbackDirective,
  ],
  templateUrl: './community-discovery-page.component.html',
  styleUrl: './community-discovery-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityDiscoveryPageComponent {
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly route = inject(ActivatedRoute);
  private readonly loadRequests$ = new Subject<LoadRequest>();

  readonly sourceType: CommunityPreviewSourceType =
    this.route.snapshot.data['sourceType'] === 'venue' ? 'venue' : 'community';
  readonly definition = getSocialSpaceDefinition(this.sourceType);
  readonly title = this.definition.pluralLabel;
  readonly description = this.definition.description;
  readonly emptyMessage = this.sourceType === 'venue'
    ? 'Nenhum Local disponível.'
    : 'Nenhuma Comunidade disponível.';
  readonly canCreateVenue = this.sourceType === 'venue';

  readonly state$ = this.loadRequests$.pipe(
    startWith<LoadRequest>({ cursor: null, append: false }),
    exhaustMap((request) =>
      this.repository
        .getDiscoveryPage$({
          limit: 12,
          cursor: request.cursor,
          sourceType: this.sourceType,
        })
        .pipe(
          map(
            (page): LoadEvent => ({
              type: 'success',
              request,
              page,
            })
          ),
          startWith<LoadEvent>({ type: 'loading', request }),
          catchError((error: unknown) => {
            this.reportError(error);
            return of<LoadEvent>({ type: 'error', request });
          })
        )
    ),
    scan(reduceState, INITIAL_STATE),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  loadMore(cursor: string | null): void {
    if (cursor) this.loadRequests$.next({ cursor, append: true });
  }

  retry(): void {
    this.loadRequests$.next({ cursor: null, append: false });
  }

  sourceLabel(item: CommunityPreviewCard): string {
    return getSocialSpaceDefinition(item.source.type).label;
  }

  accessLabel(item: CommunityPreviewCard): string | null {
    if (!item.access.requiresActiveSubscription) return null;

    const role = item.access.minimumRole;
    return role === 'vip' ? 'VIP' : role === 'premium' ? 'Premium' : 'Assinantes';
  }

  detailsRoute(item: CommunityPreviewCard): readonly string[] {
    return item.source.type === 'venue'
      ? ['/dashboard/locais', item.communityId]
      : ['/dashboard/comunidades', item.communityId];
  }

  private reportError(error: unknown): void {
    try {
      this.errorNotifier.showError(
        `Não foi possível carregar ${this.definition.pluralLabel.toLowerCase()}.`
      );
    } catch {
      // A observabilidade abaixo permanece ativa.
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityDiscoveryPageComponent',
        op: 'loadPage',
        sourceType: this.sourceType,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
