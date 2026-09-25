// src/app/community/feed/community-feed-timeline.facade.ts
import { Injectable, inject } from '@angular/core';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  concatMap,
  exhaustMap,
  map,
  merge,
  of,
  scan,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityFeedPage,
  CommunityFeedView,
  DEFAULT_COMMUNITY_FEED_PAGE_SIZE,
} from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityRealtimeAttentionCoordinatorService } from '../data-access/community-realtime-attention-coordinator.service';
import { getCommunitySocialSpaceAdapter } from '../presentation/community-social-space.adapter';
import type { CommunityFeedRealtimeChange } from '../data-access/community-feed-realtime.model';
import type { CommunityPreviewSourceType } from '../data-access/community-preview.model';
import {
  CommunityFeedLoadEvent,
  CommunityFeedLoadRequest,
  CommunityFeedState,
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed-state.model';

export interface CommunityFeedTimelineHooks {
  readonly onRealtimeChanges: (
    changes: readonly CommunityFeedRealtimeChange[],
    communityId: string
  ) => void;
  readonly captureRealtimeFollowIntent: () => boolean;
  readonly commitRealtimeFollowIntent: (shouldFollow: boolean) => void;
  readonly clearRealtimeFollowIntent: () => void;
}

export interface CommunityFeedTimelineConfig {
  readonly scope$: Observable<readonly [string, CommunityFeedView]>;
  readonly sourceType: () => CommunityPreviewSourceType;
  readonly hooks: CommunityFeedTimelineHooks;
}

interface CommunityFeedPageLoaded {
  readonly request: CommunityFeedLoadRequest;
  readonly page: CommunityFeedPage;
}

@Injectable()
export class CommunityFeedTimelineFacade {
  private readonly repository = inject(CommunityFeedRepository);
  private readonly realtimeAttention = inject(
    CommunityRealtimeAttentionCoordinatorService
  );
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly loadRequests$ = new Subject<CommunityFeedLoadRequest>();
  private readonly realtimeHydrationRequests$ = new Subject<string>();
  private readonly localFeedEvents$ = new Subject<CommunityFeedLoadEvent>();
  private readonly pageLoadedSubject = new Subject<CommunityFeedPageLoaded>();

  readonly pageLoaded$ = this.pageLoadedSubject.asObservable();

  connect(config: CommunityFeedTimelineConfig): Observable<CommunityFeedState> {
    return config.scope$.pipe(
      switchMap(([communityId, view]) => {
        const pageEvents$ = this.loadRequests$.pipe(
          startWith<CommunityFeedLoadRequest>({
            cursor: null,
            append: false,
            preserve: true,
          }),
          exhaustMap((request) =>
            this.repository
              .getPage$({
                communityId,
                view,
                limit: DEFAULT_COMMUNITY_FEED_PAGE_SIZE,
                cursor: request.cursor,
              })
              .pipe(
                tap((page) =>
                  this.pageLoadedSubject.next({ request, page })
                ),
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
                  this.reportLoadError(
                    error,
                    view,
                    config.sourceType()
                  );
                  return of<CommunityFeedLoadEvent>({
                    type: 'error',
                    request,
                  });
                })
              )
          )
        );

        const realtimeEvents$ = this.realtimeAttention
          .claimMode$(communityId)
          .pipe(
            switchMap((attentionMode) => {
              if (attentionMode !== 'detailed') {
                return EMPTY;
              }

              return this.repository
                .watchLatestChanges$(communityId, 20)
                .pipe(
                  tap((changes) =>
                    config.hooks.onRealtimeChanges(changes, communityId)
                  ),
                  concatMap((changes) =>
                    this.buildRealtimeEvent$(
                      communityId,
                      view,
                      changes,
                      config
                    )
                  ),
                  catchError((error: unknown) => {
                    this.reportTechnicalError(
                      error,
                      'watchRealtime',
                      view,
                      config.sourceType()
                    );
                    return EMPTY;
                  })
                );
            })
          );

        const directedHydrationEvents$ =
          this.realtimeHydrationRequests$.pipe(
            concatMap((postId) =>
              this.repository
                .getItems$({
                  communityId,
                  view,
                  postIds: [postId],
                })
                .pipe(
                  map((page): CommunityFeedLoadEvent => ({
                    type: 'realtime',
                    upserts: page.items,
                    metricPatches: [],
                    removedIds: [],
                  })),
                  catchError((error: unknown) => {
                    this.reportTechnicalError(
                      error,
                      'hydrateRealtimeItem',
                      view,
                      config.sourceType()
                    );
                    return EMPTY;
                  })
                )
            )
          );

        return merge(
          pageEvents$,
          realtimeEvents$,
          directedHydrationEvents$,
          this.localFeedEvents$
        ).pipe(
          scan(reduceCommunityFeedState, INITIAL_COMMUNITY_FEED_STATE)
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  loadMore(cursor: string | null): void {
    if (!cursor) return;
    this.loadRequests$.next({ cursor, append: true });
  }

  retry(): void {
    this.loadRequests$.next({
      cursor: null,
      append: false,
      preserve: true,
    });
  }

  hydratePost(postId: string): void {
    const normalizedPostId = postId.trim();
    if (!normalizedPostId) return;
    this.realtimeHydrationRequests$.next(normalizedPostId);
  }

  applyLocalEvent(event: CommunityFeedLoadEvent): void {
    this.localFeedEvents$.next(event);
  }

  private buildRealtimeEvent$(
    communityId: string,
    view: CommunityFeedView,
    changes: readonly CommunityFeedRealtimeChange[],
    config: CommunityFeedTimelineConfig
  ): Observable<CommunityFeedLoadEvent> {
    const relevant = changes.filter((change) =>
      view === 'feed' || change.projection.kind === 'photo'
    );
    if (relevant.length === 0) return EMPTY;

    const removedIds = relevant
      .filter((change) =>
        change.type === 'removed' || change.projection.state === 'removed'
      )
      .map((change) => change.projection.postId);
    const active = relevant.filter((change) =>
      change.type !== 'removed' && change.projection.state === 'active'
    );
    const metricPatches = active.map((change) => ({
      postId: change.projection.postId,
      metrics: { ...change.projection.metrics },
    }));
    const addedIds = active
      .filter((change) => change.type === 'added')
      .map((change) => change.projection.postId);
    const baseEvent: CommunityFeedLoadEvent = {
      type: 'realtime',
      upserts: [],
      metricPatches,
      removedIds,
    };

    if (addedIds.length === 0) return of(baseEvent);

    const shouldFollowLatest =
      config.hooks.captureRealtimeFollowIntent();

    return this.repository
      .getItems$({
        communityId,
        view,
        postIds: addedIds,
      })
      .pipe(
        map((page): CommunityFeedLoadEvent => {
          config.hooks.commitRealtimeFollowIntent(shouldFollowLatest);
          return {
            ...baseEvent,
            upserts: page.items,
          };
        }),
        catchError((error: unknown) => {
          config.hooks.clearRealtimeFollowIntent();
          this.reportTechnicalError(
            error,
            'hydrateRealtimeItem',
            view,
            config.sourceType()
          );
          return of(baseEvent);
        })
      );
  }

  private reportLoadError(
    error: unknown,
    view: CommunityFeedView,
    sourceType: CommunityPreviewSourceType
  ): void {
    const fallbackMessage = view === 'photos'
      ? 'Não foi possível carregar as fotos agora.'
      : getCommunitySocialSpaceAdapter(sourceType).feed(view).errorLabel;

    this.applicationError.report(error, {
      feature: 'community',
      operation: 'loadPage',
      fallbackMessage,
      notification: 'none',
      metadata: {
        scope: 'CommunityFeedTimelineFacade',
        view,
        sourceType,
      },
    });
  }

  private reportTechnicalError(
    error: unknown,
    operation: 'watchRealtime' | 'hydrateRealtimeItem',
    view: CommunityFeedView,
    sourceType: CommunityPreviewSourceType
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation,
      fallbackMessage: 'Não foi possível concluir esta atualização agora.',
      notification: 'none',
      metadata: {
        scope: 'CommunityFeedTimelineFacade',
        view,
        sourceType,
      },
    });
  }
}
