// src/app/community/discovery/community-discovery-cache.service.ts
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, map, of, switchMap, take } from 'rxjs';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import * as CommunityDiscoveryCacheActions from 'src/app/store/actions/actions.discovery/community-discovery-cache.actions';
import { selectCommunityDiscoveryCacheSlice } from 'src/app/store/selectors/selectors.discovery/community-discovery-cache.selectors';
import type { AppState } from 'src/app/store/states/app.state';
import { CommunityDomainEventsService } from '../data-access/community-domain-events.service';
import type { CommunityDiscoveryPage } from '../data-access/community-preview.model';
import {
  CommunityDiscoveryCacheContext,
  CommunityDiscoveryCacheQuery,
  CommunityDiscoveryListState,
  INITIAL_COMMUNITY_DISCOVERY_LIST_STATE,
  buildCommunityDiscoveryCacheKey,
  buildCommunityDiscoveryCacheQuery,
  isCommunityDiscoveryCacheSoftFresh,
  normalizeCommunityDiscoveryViewerUid,
} from './community-discovery-cache.model';

export interface CommunityDiscoveryCacheSnapshot {
  readonly page: CommunityDiscoveryPage;
  readonly fresh: boolean;
}

@Injectable({ providedIn: 'root' })
export class CommunityDiscoveryCacheService {
  private readonly store = inject(Store<AppState>);
  private readonly session = inject(AuthSessionService);
  private readonly domainEvents = inject(CommunityDomainEventsService);
  private readonly destroyRef = inject(DestroyRef);
  private activeViewerUid: string | null = null;

  constructor() {
    this.session.uid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        const viewerUid = normalizeCommunityDiscoveryViewerUid(uid) || null;
        this.activeViewerUid = viewerUid;
        this.store.dispatch(
          CommunityDiscoveryCacheActions.activateCommunityDiscoveryViewer({
            viewerUid,
          })
        );
      });

    this.domainEvents.discoveryChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.invalidateCurrentViewer());
  }

  state$(
    context: CommunityDiscoveryCacheContext
  ): Observable<CommunityDiscoveryListState> {
    return this.session.uid$.pipe(
      switchMap((uid) => {
        const query = buildCommunityDiscoveryCacheQuery(uid, context);
        if (!query) return of(INITIAL_COMMUNITY_DISCOVERY_LIST_STATE);

        const queryKey = buildCommunityDiscoveryCacheKey(query);
        return this.store.select(selectCommunityDiscoveryCacheSlice(queryKey)).pipe(
          map((slice): CommunityDiscoveryListState => {
            if (!slice) return INITIAL_COMMUNITY_DISCOVERY_LIST_STATE;

            return {
              status: slice.status,
              items: slice.items,
              nextCursor: slice.nextCursor,
              loadingMore: slice.loadingMore,
            };
          })
        );
      })
    );
  }

  readSnapshot$(
    context: CommunityDiscoveryCacheContext
  ): Observable<CommunityDiscoveryCacheSnapshot | null> {
    return this.session.uid$.pipe(
      take(1),
      switchMap((uid) => {
        const query = buildCommunityDiscoveryCacheQuery(uid, context);
        if (!query) return of(null);

        const accessedAt = Date.now();
        this.store.dispatch(
          CommunityDiscoveryCacheActions.touchCommunityDiscoveryQuery({
            query,
            accessedAt,
          })
        );

        const queryKey = buildCommunityDiscoveryCacheKey(query);
        return this.store.select(selectCommunityDiscoveryCacheSlice(queryKey)).pipe(
          take(1),
          map((slice): CommunityDiscoveryCacheSnapshot | null => {
            if (!slice || slice.lastLoadedAt <= 0) return null;

            return {
              page: {
                items: slice.items,
                nextCursor: slice.nextCursor,
                generatedAt: slice.lastLoadedAt,
              },
              fresh:
                !slice.invalidated
                && isCommunityDiscoveryCacheSoftFresh(
                  slice.lastLoadedAt,
                  accessedAt
                ),
            };
          })
        );
      })
    );
  }

  beginLoad(
    context: CommunityDiscoveryCacheContext,
    append: boolean
  ): void {
    const query = this.resolveCurrentQuery(context);
    if (!query) return;

    this.store.dispatch(
      CommunityDiscoveryCacheActions.beginCommunityDiscoveryLoad({
        query,
        append,
        startedAt: Date.now(),
      })
    );
  }

  rememberPage(
    context: CommunityDiscoveryCacheContext,
    page: CommunityDiscoveryPage,
    append: boolean
  ): void {
    const query = this.resolveCurrentQuery(context);
    if (!query) return;

    this.store.dispatch(
      CommunityDiscoveryCacheActions.storeCommunityDiscoveryPage({
        query,
        page,
        append,
        storedAt: Date.now(),
      })
    );
  }

  failLoad(
    context: CommunityDiscoveryCacheContext,
    append: boolean
  ): void {
    const query = this.resolveCurrentQuery(context);
    if (!query) return;

    this.store.dispatch(
      CommunityDiscoveryCacheActions.failCommunityDiscoveryLoad({
        query,
        append,
        failedAt: Date.now(),
      })
    );
  }

  invalidateCurrentViewer(): void {
    const viewerUid =
      this.activeViewerUid
      || normalizeCommunityDiscoveryViewerUid(
        this.session.currentAuthUser?.uid
      )
      || null;
    if (!viewerUid) return;

    this.store.dispatch(
      CommunityDiscoveryCacheActions.invalidateCommunityDiscoveryViewer({
        viewerUid,
      })
    );
  }

  private resolveCurrentQuery(
    context: CommunityDiscoveryCacheContext
  ): CommunityDiscoveryCacheQuery | null {
    const viewerUid =
      this.activeViewerUid
      || normalizeCommunityDiscoveryViewerUid(
        this.session.currentAuthUser?.uid
      )
      || null;

    return buildCommunityDiscoveryCacheQuery(viewerUid, context);
  }
}
