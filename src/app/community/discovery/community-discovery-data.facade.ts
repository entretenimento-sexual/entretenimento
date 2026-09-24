// src/app/community/discovery/community-discovery-data.facade.ts
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  Subject,
  catchError,
  concat,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityDiscoveryPage,
  CommunityPreviewCard,
  CommunityPreviewSourceType,
} from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import {
  CommunityDiscoveryCacheContext,
  CommunityDiscoveryMode,
  DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
} from './community-discovery-cache.model';
import { CommunityDiscoveryCacheService } from './community-discovery-cache.service';

export type CommunityDiscoveryStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface CommunityDiscoveryState {
  readonly status: CommunityDiscoveryStatus;
  readonly items: readonly CommunityPreviewCard[];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
}

export interface CommunityDiscoveryLoadRequest {
  readonly cursor: string | null;
  readonly append: boolean;
  readonly tagId: string | null;
}

export interface CommunityDiscoveryPageLoaded {
  readonly request: CommunityDiscoveryLoadRequest;
  readonly page: CommunityDiscoveryPage;
}

type CommunityDiscoveryLoadEvent =
  | { type: 'loading'; request: CommunityDiscoveryLoadRequest }
  | {
      type: 'success';
      request: CommunityDiscoveryLoadRequest;
      page: CommunityDiscoveryPage;
    }
  | { type: 'error'; request: CommunityDiscoveryLoadRequest };

export interface CommunityDiscoveryDataConfig {
  readonly sourceType: CommunityPreviewSourceType;
  readonly discoveryMode: CommunityDiscoveryMode;
  readonly canFilterByTags: boolean;
  readonly title: string;
  readonly initialTagId: string | null;
}

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
  event: CommunityDiscoveryLoadEvent
): CommunityDiscoveryState {
  if (event.type === 'loading') {
    return event.request.append
      ? { ...state, loadingMore: true }
      : INITIAL_STATE;
  }

  if (event.type === 'error') {
    if (state.items.length > 0) {
      return { ...state, loadingMore: false };
    }

    return {
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

@Injectable()
export class CommunityDiscoveryDataFacade {
  private readonly repository = inject(CommunityPreviewRepository);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly loadRequests$ = new Subject<CommunityDiscoveryLoadRequest>();
  private readonly pageLoadedSubject = new Subject<CommunityDiscoveryPageLoaded>();

  readonly pageLoaded$ = this.pageLoadedSubject.asObservable();

  connect(config: CommunityDiscoveryDataConfig): Observable<CommunityDiscoveryState> {
    return this.loadRequests$.pipe(
      startWith<CommunityDiscoveryLoadRequest>({
        cursor: null,
        append: false,
        tagId: config.initialTagId,
      }),
      switchMap((request) =>
        this.resolveLoadEvents$(request, config).pipe(
          startWith<CommunityDiscoveryLoadEvent>({ type: 'loading', request }),
          catchError((error: unknown) =>
            this.recoverLoadError$(error, request, config)
          )
        )
      ),
      scan(reduceState, INITIAL_STATE),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  loadMore(cursor: string | null, tagId: string | null): void {
    if (!cursor) return;
    this.loadRequests$.next({ cursor, append: true, tagId });
  }

  reload(tagId: string | null): void {
    this.loadRequests$.next({ cursor: null, append: false, tagId });
  }

  private resolveLoadEvents$(
    request: CommunityDiscoveryLoadRequest,
    config: CommunityDiscoveryDataConfig
  ): Observable<CommunityDiscoveryLoadEvent> {
    const context = this.cacheContext(request.tagId, config);

    if (request.append) {
      return this.fetchPageEvent$(request, context, config);
    }

    return this.discoveryCache.readSnapshot$(context).pipe(
      switchMap((snapshot) => {
        if (!snapshot) {
          return this.fetchPageEvent$(request, context, config);
        }

        const cachedEvent: CommunityDiscoveryLoadEvent = {
          type: 'success',
          request,
          page: snapshot.page,
        };
        const cached$ = of(cachedEvent).pipe(
          tap(() => this.pageLoadedSubject.next({
            request,
            page: snapshot.page,
          }))
        );

        if (snapshot.fresh) {
          return cached$;
        }

        return concat(
          cached$,
          this.fetchPageEvent$(request, context, config)
        );
      })
    );
  }

  private fetchPageEvent$(
    request: CommunityDiscoveryLoadRequest,
    context: CommunityDiscoveryCacheContext,
    config: CommunityDiscoveryDataConfig
  ): Observable<CommunityDiscoveryLoadEvent> {
    const page$ = config.discoveryMode === 'mine'
      ? this.repository.getMyCommunitiesPage$({
          limit: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
          cursor: request.cursor,
          sourceType: 'community',
        })
      : this.repository.getDiscoveryPage$({
          limit: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
          cursor: request.cursor,
          sourceType: config.sourceType,
          tagId: config.canFilterByTags ? request.tagId : null,
        });

    return page$.pipe(
      tap((page) => {
        this.discoveryCache.rememberPage(context, page, request.append);
        this.pageLoadedSubject.next({ request, page });
      }),
      map(
        (page): CommunityDiscoveryLoadEvent => ({
          type: 'success',
          request,
          page,
        })
      )
    );
  }

  private recoverLoadError$(
    error: unknown,
    request: CommunityDiscoveryLoadRequest,
    config: CommunityDiscoveryDataConfig
  ): Observable<CommunityDiscoveryLoadEvent> {
    const options = {
      feature: 'community',
      operation: 'loadDiscoveryPage',
      fallbackMessage:
        `Não foi possível carregar ${config.title.toLowerCase()}.`,
      metadata: this.errorMetadata(request.tagId, config),
    } as const;
    const descriptor = this.applicationError.normalize(error, options);

    if (
      request.append
      && config.discoveryMode === 'explore'
      && descriptor.code === 'aborted'
    ) {
      this.applicationError.report(error, {
        ...options,
        notification: 'none',
      });
      const resetRequest: CommunityDiscoveryLoadRequest = {
        cursor: null,
        append: false,
        tagId: request.tagId,
      };

      return this.fetchPageEvent$(
        resetRequest,
        this.cacheContext(resetRequest.tagId, config),
        config
      ).pipe(
        catchError((refreshError: unknown) => {
          this.reportError(refreshError, resetRequest.tagId, config);
          return of<CommunityDiscoveryLoadEvent>({ type: 'error', request });
        })
      );
    }

    this.applicationError.report(error, options);
    return of<CommunityDiscoveryLoadEvent>({ type: 'error', request });
  }

  private cacheContext(
    tagId: string | null,
    config: CommunityDiscoveryDataConfig
  ): CommunityDiscoveryCacheContext {
    return {
      sourceType: config.sourceType,
      discoveryMode: config.discoveryMode,
      tagId: config.canFilterByTags ? tagId : null,
      pageSize: DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
    };
  }

  private reportError(
    error: unknown,
    tagId: string | null,
    config: CommunityDiscoveryDataConfig
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'loadDiscoveryPage',
      fallbackMessage:
        `Não foi possível carregar ${config.title.toLowerCase()}.`,
      metadata: this.errorMetadata(tagId, config),
    });
  }

  private errorMetadata(
    tagId: string | null,
    config: CommunityDiscoveryDataConfig
  ): Readonly<Record<string, unknown>> {
    return {
      scope: 'CommunityDiscoveryDataFacade',
      sourceType: config.sourceType,
      discoveryMode: config.discoveryMode,
      tagId,
    };
  }
}
