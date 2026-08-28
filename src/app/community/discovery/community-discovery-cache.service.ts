// src/app/community/discovery/community-discovery-cache.service.ts
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, map, of, switchMap, take } from 'rxjs';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import * as CommunityDiscoveryCacheActions from 'src/app/store/actions/actions.discovery/community-discovery-cache.actions';
import { selectCommunityDiscoveryCacheSlice } from 'src/app/store/selectors/selectors.discovery/community-discovery-cache.selectors';
import type { AppState } from 'src/app/store/states/app.state';
import type { CommunityDiscoveryPage } from '../data-access/community-preview.model';
import {
  CommunityDiscoveryCacheContext,
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
            if (!slice) return null;

            return {
              page: {
                items: slice.items,
                nextCursor: slice.nextCursor,
                generatedAt: slice.lastLoadedAt,
              },
              fresh: isCommunityDiscoveryCacheSoftFresh(
                slice.lastLoadedAt,
                accessedAt
              ),
            };
          })
        );
      })
    );
  }

  rememberPage(
    context: CommunityDiscoveryCacheContext,
    page: CommunityDiscoveryPage,
    append: boolean
  ): void {
    const viewerUid =
      this.activeViewerUid
      || normalizeCommunityDiscoveryViewerUid(
        this.session.currentAuthUser?.uid
      )
      || null;
    const query = buildCommunityDiscoveryCacheQuery(viewerUid, context);
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

  invalidateCurrentViewer(): void {
    const viewerUid = this.activeViewerUid;
    if (!viewerUid) return;

    this.store.dispatch(
      CommunityDiscoveryCacheActions.invalidateCommunityDiscoveryViewer({
        viewerUid,
      })
    );
  }
}
