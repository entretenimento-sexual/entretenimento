// src/app/explore/services/explore-personal-media.service.ts
// -----------------------------------------------------------------------------
// Fonte pessoal do feed Descobrir.
// - amigos mantêm precedência sem bloquear rotação de perfis compatíveis;
// - autores são consultados em lotes independentes, cada um com cursor próprio;
// - novas páginas de amigos/compatíveis reutilizam os fluxos NgRx canônicos;
// - mídia pública usa collection-group paginada e deduplicação entre lotes;
// - URLs temporárias continuam fora do NgRx e erros técnicos ficam centralizados.
// -----------------------------------------------------------------------------

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  forkJoin,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import {
  IPublicMediaOwnerCursor,
  IPublicPhotoOwnerPage,
  IPublicVideoOwnerPage,
} from 'src/app/core/interfaces/media/i-public-media-owner-page';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicMediaOwnerPageQueryService } from 'src/app/core/services/media/public-media-owner-page-query.service';
import {
  CompatibleProfileCandidatePool,
  CompatibleProfileCandidatesService,
} from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
import * as FriendsPageActions from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import { selectFriendsPageSlice } from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';
import { AppState } from 'src/app/store/states/app.state';
import type { FriendsPageSlice } from 'src/app/store/states/states.interactions/friends-pagination.state';
import {
  buildNextExploreOwnerBatch,
  hasUnusedExploreOwners,
} from '../models/explore-owner-pool';

const PREFERRED_FRIENDS_PER_OWNER_BATCH = 8;
const OWNER_BATCH_SIZE = 12;
const PERSONAL_MEDIA_PAGE_SIZE = 12;
const FRIENDS_PAGE_SIZE = 18;
const MAX_OWNER_SOURCE_SCANS_PER_REQUEST = 4;

interface ExplorePersonalMediaPageBundle {
  readonly photos: IPublicPhotoOwnerPage;
  readonly videos: IPublicVideoOwnerPage;
}

interface ExploreOwnerMediaBatchState {
  readonly key: string;
  readonly ownerUids: readonly string[];
  readonly photoCursor: IPublicMediaOwnerCursor | null;
  readonly videoCursor: IPublicMediaOwnerCursor | null;
  readonly hasMorePhotos: boolean;
  readonly hasMoreVideos: boolean;
}

interface ExplorePersonalMediaState {
  readonly viewerUid: string;
  readonly batches: readonly ExploreOwnerMediaBatchState[];
  readonly personalPhotos: readonly IPublicPhotoItem[];
  readonly personalVideos: readonly IPublicVideoItem[];
  readonly nextMediaBatchIndex: number;
  readonly loadingInitial: boolean;
  readonly loadingMore: boolean;
  readonly loadFailed: boolean;
}

interface ExploreFriendOwnerPool {
  readonly viewerUid: string;
  readonly ownerUids: readonly string[];
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly nextOrderValue: number | null;
  readonly reachedEnd: boolean;
  readonly error: string | null;
}

interface ExploreNewBatchResult {
  readonly added: boolean;
  readonly failed: boolean;
}

export interface ExplorePersonalMediaContext {
  readonly friendUids: readonly string[];
  readonly compatibleOwnerUids: readonly string[];
  readonly personalPhotos: readonly IPublicPhotoItem[];
  readonly personalVideos: readonly IPublicVideoItem[];
  readonly hasMorePersonalMedia: boolean;
  readonly loadingInitialPersonalMedia: boolean;
  readonly loadingMorePersonalMedia: boolean;
  readonly personalMediaLoadFailed: boolean;
}

@Injectable({ providedIn: 'root' })
export class ExplorePersonalMediaService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly accessControl = inject(AccessControlService);
  private readonly compatibleCandidates = inject(CompatibleProfileCandidatesService);
  private readonly ownerPageQuery = inject(PublicMediaOwnerPageQueryService);
  private readonly discoveryQuery = inject(UserDiscoveryQueryService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly mediaStateSubject =
    new BehaviorSubject<ExplorePersonalMediaState>(this.emptyState());

  private readonly viewerUid$ = combineLatest([
    this.accessControl.authUid$,
    this.accessControl.canRunApp$,
  ]).pipe(
    map(([uid, canRunApp]) =>
      canRunApp ? String(uid ?? '').trim() : ''
    ),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly friendPool$: Observable<ExploreFriendOwnerPool> =
    this.viewerUid$.pipe(
      switchMap((uid) => {
        if (!uid) {
          return of(this.emptyFriendPool());
        }

        return this.store.select(selectFriendsPageSlice(uid)).pipe(
          map((slice) => this.toFriendPool(uid, slice))
        );
      }),
      distinctUntilChanged((previous, current) =>
        this.sameFriendPool(previous, current)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly friendUids$: Observable<readonly string[]> = this.friendPool$.pipe(
    map((pool) => pool.ownerUids),
    distinctUntilChanged((previous, current) =>
      this.sameStringArray(previous, current)
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly personalPhotos$: Observable<readonly IPublicPhotoItem[]> =
    this.mediaStateSubject.pipe(
      map((state) => state.personalPhotos),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly personalVideos$: Observable<readonly IPublicVideoItem[]> =
    this.mediaStateSubject.pipe(
      map((state) => state.personalVideos),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly context$: Observable<ExplorePersonalMediaContext> = combineLatest([
    this.friendPool$,
    this.compatibleCandidates.pool$,
    this.mediaStateSubject,
  ]).pipe(
    map(([friendPool, compatiblePool, state]) => ({
      friendUids: [...friendPool.ownerUids],
      compatibleOwnerUids: [...compatiblePool.ownerUids],
      personalPhotos: state.personalPhotos,
      personalVideos: state.personalVideos,
      hasMorePersonalMedia: this.hasMorePersonalMedia(
        state,
        friendPool,
        compatiblePool
      ),
      loadingInitialPersonalMedia: state.loadingInitial,
      loadingMorePersonalMedia: state.loadingMore,
      personalMediaLoadFailed:
        state.loadFailed ||
        !!friendPool.error ||
        !!compatiblePool.error,
    })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    this.viewerUid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        this.mediaStateSubject.next(this.emptyState(uid, !!uid));

        if (!uid) return;

        this.store.dispatch(
          FriendsPageActions.loadFriendsFirstPage({
            uid,
            pageSize: FRIENDS_PAGE_SIZE,
          })
        );
      });

    this.viewerUid$.pipe(
      switchMap((uid) => {
        if (!uid) {
          return of(null);
        }

        return combineLatest([
          this.friendPool$,
          this.compatibleCandidates.pool$,
        ]).pipe(
          filter(([friendPool, compatiblePool]) =>
            friendPool.viewerUid === uid &&
            this.friendPoolReadyForInitial(friendPool) &&
            this.compatiblePoolReadyForInitial(compatiblePool)
          ),
          take(1),
          switchMap(([friendPool, compatiblePool]) => {
            const ownerUids = this.buildNextOwnerBatch(
              friendPool.ownerUids,
              compatiblePool.ownerUids,
              []
            );

            if (!ownerUids.length) {
              return of({
                uid,
                ownerUids,
                bundle: this.emptyBundle(),
                sourceFailed: !!friendPool.error || !!compatiblePool.error,
              });
            }

            return this.loadPageBundle$(
              ownerUids,
              null,
              null,
              true,
              true
            ).pipe(
              map((bundle) => ({
                uid,
                ownerUids,
                bundle,
                sourceFailed: !!friendPool.error || !!compatiblePool.error,
              }))
            );
          })
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((result) => {
      if (!result) {
        return;
      }

      const current = this.mediaStateSubject.value;
      if (current.viewerUid !== result.uid) {
        return;
      }

      if (!result.ownerUids.length) {
        this.mediaStateSubject.next({
          ...current,
          loadingInitial: false,
          loadFailed: result.sourceFailed,
        });
        return;
      }

      const batch = this.batchFromBundle(result.ownerUids, result.bundle);
      this.mediaStateSubject.next({
        ...current,
        batches: [batch],
        personalPhotos: this.mergeMedia(
          current.personalPhotos,
          result.bundle.photos.items
        ),
        personalVideos: this.mergeMedia(
          current.personalVideos,
          result.bundle.videos.items
        ),
        nextMediaBatchIndex: 0,
        loadingInitial: false,
        loadFailed:
          result.sourceFailed ||
          result.bundle.photos.failed ||
          result.bundle.videos.failed,
      });
    });

    combineLatest([
      this.friendPool$,
      this.compatibleCandidates.pool$,
    ]).pipe(
      filter(([friendPool, compatiblePool]) =>
        friendPool.initialized &&
        compatiblePool.initialized &&
        !friendPool.loading &&
        !compatiblePool.loadingInitial &&
        !compatiblePool.loadingMore &&
        !compatiblePool.refreshing
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([friendPool, compatiblePool]) => {
      this.reconcileRelationships(friendPool, compatiblePool);
    });
  }

  loadMore$(): Observable<boolean> {
    const snapshot = this.mediaStateSubject.value;

    if (
      !snapshot.viewerUid ||
      snapshot.loadingInitial ||
      snapshot.loadingMore
    ) {
      return of(false);
    }

    this.mediaStateSubject.next({
      ...snapshot,
      loadingMore: true,
      loadFailed: false,
    });

    return this.loadNextAvailable$(snapshot.viewerUid, 0).pipe(
      take(1),
      finalize(() => {
        const current = this.mediaStateSubject.value;

        if (
          current.viewerUid === snapshot.viewerUid &&
          current.loadingMore
        ) {
          this.mediaStateSubject.next({
            ...current,
            loadingMore: false,
          });
        }
      })
    );
  }

  private loadNextAvailable$(
    viewerUid: string,
    sourceScanDepth: number
  ): Observable<boolean> {
    return combineLatest([
      this.friendPool$,
      this.compatibleCandidates.pool$,
    ]).pipe(
      take(1),
      switchMap(([friendPool, compatiblePool]) => {
        const current = this.mediaStateSubject.value;
        if (current.viewerUid !== viewerUid) {
          return of(false);
        }

        const usedOwnerUids = this.usedOwnerUids(current.batches);
        const nextOwnerUids = this.buildNextOwnerBatch(
          friendPool.ownerUids,
          compatiblePool.ownerUids,
          usedOwnerUids
        );

        if (nextOwnerUids.length) {
          return this.loadNewOwnerBatch$(viewerUid, nextOwnerUids).pipe(
            switchMap((result) => {
              if (result.failed || result.added) {
                return of(result.added);
              }

              if (sourceScanDepth >= MAX_OWNER_SOURCE_SCANS_PER_REQUEST) {
                return this.loadNextMediaBatchPage$(viewerUid);
              }

              return this.loadNextAvailable$(viewerUid, sourceScanDepth + 1);
            })
          );
        }

        if (
          sourceScanDepth < MAX_OWNER_SOURCE_SCANS_PER_REQUEST &&
          this.canLoadMoreOwnerSources(friendPool, compatiblePool)
        ) {
          return this.loadMoreOwnerSources$(friendPool, compatiblePool).pipe(
            switchMap(() =>
              this.loadNextAvailable$(viewerUid, sourceScanDepth + 1)
            )
          );
        }

        return this.loadNextMediaBatchPage$(viewerUid);
      })
    );
  }

  private loadNewOwnerBatch$(
    viewerUid: string,
    ownerUids: readonly string[]
  ): Observable<ExploreNewBatchResult> {
    return this.loadPageBundle$(
      ownerUids,
      null,
      null,
      true,
      true
    ).pipe(
      take(1),
      map((bundle) => {
        const current = this.mediaStateSubject.value;
        if (current.viewerUid !== viewerUid) {
          return { added: false, failed: false };
        }

        const personalPhotos = this.mergeMedia(
          current.personalPhotos,
          bundle.photos.items
        );
        const personalVideos = this.mergeMedia(
          current.personalVideos,
          bundle.videos.items
        );
        const addedCount =
          personalPhotos.length - current.personalPhotos.length +
          personalVideos.length - current.personalVideos.length;
        const failed = bundle.photos.failed || bundle.videos.failed;
        const batch = this.batchFromBundle(ownerUids, bundle);

        this.mediaStateSubject.next({
          ...current,
          batches: [...current.batches, batch],
          personalPhotos,
          personalVideos,
          loadingMore: true,
          loadFailed: failed,
        });

        if (failed && addedCount === 0) {
          this.errorNotification.showWarning(
            'Não foi possível carregar mais publicações agora. Tente novamente.'
          );
        }

        return { added: addedCount > 0, failed };
      })
    );
  }

  private loadNextMediaBatchPage$(viewerUid: string): Observable<boolean> {
    const snapshot = this.mediaStateSubject.value;
    if (snapshot.viewerUid !== viewerUid || !snapshot.batches.length) {
      return of(false);
    }

    const batchIndex = this.findNextMediaBatchIndex(snapshot);
    if (batchIndex < 0) {
      return of(false);
    }

    const batch = snapshot.batches[batchIndex];

    return this.loadPageBundle$(
      batch.ownerUids,
      batch.photoCursor,
      batch.videoCursor,
      batch.hasMorePhotos,
      batch.hasMoreVideos
    ).pipe(
      take(1),
      map((bundle) => {
        const current = this.mediaStateSubject.value;
        const currentBatch = current.batches[batchIndex];

        if (
          current.viewerUid !== viewerUid ||
          !currentBatch ||
          currentBatch.key !== batch.key
        ) {
          return false;
        }

        const personalPhotos = this.mergeMedia(
          current.personalPhotos,
          bundle.photos.items
        );
        const personalVideos = this.mergeMedia(
          current.personalVideos,
          bundle.videos.items
        );
        const addedCount =
          personalPhotos.length - current.personalPhotos.length +
          personalVideos.length - current.personalVideos.length;
        const failed = bundle.photos.failed || bundle.videos.failed;
        const batches = [...current.batches];

        batches[batchIndex] = {
          ...currentBatch,
          photoCursor: bundle.photos.failed
            ? currentBatch.photoCursor
            : bundle.photos.nextCursor,
          videoCursor: bundle.videos.failed
            ? currentBatch.videoCursor
            : bundle.videos.nextCursor,
          hasMorePhotos: bundle.photos.failed
            ? currentBatch.hasMorePhotos
            : bundle.photos.hasMore,
          hasMoreVideos: bundle.videos.failed
            ? currentBatch.hasMoreVideos
            : bundle.videos.hasMore,
        };

        this.mediaStateSubject.next({
          ...current,
          batches,
          personalPhotos,
          personalVideos,
          nextMediaBatchIndex: batches.length
            ? (batchIndex + 1) % batches.length
            : 0,
          loadingMore: true,
          loadFailed: failed,
        });

        if (failed && addedCount === 0) {
          this.errorNotification.showWarning(
            'Não foi possível carregar mais publicações agora. Tente novamente.'
          );
        }

        return addedCount > 0;
      })
    );
  }

  private loadMoreOwnerSources$(
    friendPool: ExploreFriendOwnerPool,
    compatiblePool: CompatibleProfileCandidatePool
  ): Observable<boolean> {
    const friends$ = this.canLoadMoreFriends(friendPool)
      ? this.loadMoreFriends$(friendPool)
      : of(false);
    const compatibles$ = this.canLoadMoreCompatible(compatiblePool)
      ? this.compatibleCandidates.loadMore$()
      : of(false);

    return forkJoin({
      friends: friends$,
      compatibles: compatibles$,
    }).pipe(
      map(({ friends, compatibles }) => friends || compatibles)
    );
  }

  private loadMoreFriends$(
    pool: ExploreFriendOwnerPool
  ): Observable<boolean> {
    if (!this.canLoadMoreFriends(pool)) {
      return of(false);
    }

    const beforeCount = pool.ownerUids.length;
    const beforeReachedEnd = pool.reachedEnd;
    const beforeError = pool.error;
    const retryFirstPage =
      !!pool.error &&
      beforeCount === 0 &&
      pool.nextOrderValue === null;

    this.store.dispatch(
      retryFirstPage
        ? FriendsPageActions.loadFriendsFirstPage({
            uid: pool.viewerUid,
            pageSize: FRIENDS_PAGE_SIZE,
          })
        : FriendsPageActions.loadFriendsNextPage({
            uid: pool.viewerUid,
            pageSize: FRIENDS_PAGE_SIZE,
          })
    );

    return this.store.select(selectFriendsPageSlice(pool.viewerUid)).pipe(
      filter((slice): slice is FriendsPageSlice => {
        if (!slice || slice.loading) {
          return false;
        }

        const nextCount = this.normalizeFriendUids(slice.items).length;
        return (
          nextCount !== beforeCount ||
          slice.reachedEnd !== beforeReachedEnd ||
          slice.error !== beforeError
        );
      }),
      take(1),
      map((slice) =>
        this.normalizeFriendUids(slice.items).length > beforeCount
      )
    );
  }

  private loadPageBundle$(
    ownerUids: readonly string[],
    photoCursor: IPublicMediaOwnerCursor | null,
    videoCursor: IPublicMediaOwnerCursor | null,
    loadPhotos: boolean,
    loadVideos: boolean
  ): Observable<ExplorePersonalMediaPageBundle> {
    const profiles$ = this.discoveryQuery.getProfilesByUids$([...ownerUids], {
      cacheTTL: 300_000,
    }).pipe(
      catchError((error: unknown) => {
        this.reportOwnerError('profile-enrichment', error);
        return of([] as IUserDados[]);
      })
    );

    const photos$ = loadPhotos
      ? this.ownerPageQuery.loadPhotoPage$({
          ownerUids,
          pageSize: PERSONAL_MEDIA_PAGE_SIZE,
          cursor: photoCursor,
        })
      : of(this.emptyPhotoPage());

    const videos$ = loadVideos
      ? this.ownerPageQuery.loadVideoPage$({
          ownerUids,
          pageSize: PERSONAL_MEDIA_PAGE_SIZE,
          cursor: videoCursor,
        })
      : of(this.emptyVideoPage());

    return combineLatest([photos$, videos$, profiles$]).pipe(
      map(([photos, videos, profiles]) => {
        const profilesByUid = new Map<string, IUserDados>();

        for (const profile of profiles ?? []) {
          const uid = String(profile?.uid ?? '').trim();
          if (uid) profilesByUid.set(uid, profile);
        }

        return {
          photos: {
            ...photos,
            items: photos.items.map((photo) =>
              this.withOwnerPhotoProfile(
                photo,
                profilesByUid.get(photo.ownerUid) ?? null
              )
            ),
          },
          videos: {
            ...videos,
            items: videos.items.map((video) =>
              this.withOwnerVideoProfile(
                video,
                profilesByUid.get(video.ownerUid) ?? null
              )
            ),
          },
        };
      })
    );
  }

  private reconcileRelationships(
    friendPool: ExploreFriendOwnerPool,
    compatiblePool: CompatibleProfileCandidatePool
  ): void {
    const current = this.mediaStateSubject.value;
    if (!current.viewerUid || current.viewerUid !== friendPool.viewerUid) {
      return;
    }

    const validOwners = new Set([
      ...friendPool.ownerUids,
      ...compatiblePool.ownerUids,
    ]);

    if (!current.batches.length) {
      return;
    }

    let batchesChanged = false;
    const batches = current.batches.flatMap((batch) => {
      const ownerUids = batch.ownerUids.filter((uid) => validOwners.has(uid));

      if (ownerUids.length === batch.ownerUids.length) {
        return [batch];
      }

      batchesChanged = true;

      if (!ownerUids.length) {
        return [];
      }

      // O cursor pertence à consulta com o conjunto original de ownerUid.
      // Se a relação mudou, mantemos a mídia já carregada, mas não reutilizamos
      // esse cursor para uma query semanticamente diferente.
      return [{
        key: this.ownerKey(ownerUids),
        ownerUids,
        photoCursor: null,
        videoCursor: null,
        hasMorePhotos: false,
        hasMoreVideos: false,
      }];
    });

    const personalPhotos = current.personalPhotos.filter((item) =>
      validOwners.has(String(item.ownerUid ?? '').trim())
    );
    const personalVideos = current.personalVideos.filter((item) =>
      validOwners.has(String(item.ownerUid ?? '').trim())
    );
    const mediaChanged =
      personalPhotos.length !== current.personalPhotos.length ||
      personalVideos.length !== current.personalVideos.length;

    if (!batchesChanged && !mediaChanged) {
      return;
    }

    this.mediaStateSubject.next({
      ...current,
      batches,
      personalPhotos,
      personalVideos,
      nextMediaBatchIndex: batches.length
        ? Math.min(current.nextMediaBatchIndex, batches.length - 1)
        : 0,
    });
  }

  private hasMorePersonalMedia(
    state: ExplorePersonalMediaState,
    friendPool: ExploreFriendOwnerPool,
    compatiblePool: CompatibleProfileCandidatePool
  ): boolean {
    const usedOwners = this.usedOwnerUids(state.batches);

    return (
      state.batches.some(
        (batch) => batch.hasMorePhotos || batch.hasMoreVideos
      ) ||
      hasUnusedExploreOwners(
        friendPool.ownerUids,
        compatiblePool.ownerUids,
        usedOwners
      ) ||
      this.canLoadMoreOwnerSources(friendPool, compatiblePool)
    );
  }

  private canLoadMoreOwnerSources(
    friendPool: ExploreFriendOwnerPool,
    compatiblePool: CompatibleProfileCandidatePool
  ): boolean {
    return (
      this.canLoadMoreFriends(friendPool) ||
      this.canLoadMoreCompatible(compatiblePool)
    );
  }

  private canLoadMoreFriends(pool: ExploreFriendOwnerPool): boolean {
    if (!pool.initialized || pool.loading || !pool.viewerUid) {
      return false;
    }

    if (
      pool.error &&
      pool.ownerUids.length === 0 &&
      pool.nextOrderValue === null
    ) {
      return true;
    }

    return !pool.reachedEnd && pool.nextOrderValue !== null;
  }

  private canLoadMoreCompatible(
    pool: CompatibleProfileCandidatePool
  ): boolean {
    if (
      !pool.initialized ||
      pool.loadingInitial ||
      pool.loadingMore ||
      pool.refreshing
    ) {
      return false;
    }

    return pool.hasMore || !!pool.error;
  }

  private friendPoolReadyForInitial(pool: ExploreFriendOwnerPool): boolean {
    return pool.initialized && !pool.loading;
  }

  private compatiblePoolReadyForInitial(
    pool: CompatibleProfileCandidatePool
  ): boolean {
    if (
      !pool.initialized ||
      pool.loadingInitial ||
      pool.loadingMore ||
      pool.refreshing
    ) {
      return false;
    }

    return (
      pool.ownerUids.length >= OWNER_BATCH_SIZE ||
      !pool.hasMore ||
      !!pool.error
    );
  }

  private findNextMediaBatchIndex(state: ExplorePersonalMediaState): number {
    if (!state.batches.length) {
      return -1;
    }

    const start = state.nextMediaBatchIndex % state.batches.length;

    for (let offset = 0; offset < state.batches.length; offset += 1) {
      const index = (start + offset) % state.batches.length;
      const batch = state.batches[index];

      if (batch.hasMorePhotos || batch.hasMoreVideos) {
        return index;
      }
    }

    return -1;
  }

  private buildNextOwnerBatch(
    friendUids: readonly string[],
    compatibleUids: readonly string[],
    usedOwnerUids: readonly string[] | ReadonlySet<string>
  ): string[] {
    return buildNextExploreOwnerBatch(
      friendUids,
      compatibleUids,
      usedOwnerUids,
      {
        batchSize: OWNER_BATCH_SIZE,
        preferredFriendCount: PREFERRED_FRIENDS_PER_OWNER_BATCH,
      }
    );
  }

  private batchFromBundle(
    ownerUids: readonly string[],
    bundle: ExplorePersonalMediaPageBundle
  ): ExploreOwnerMediaBatchState {
    return {
      key: this.ownerKey(ownerUids),
      ownerUids: [...ownerUids],
      photoCursor: bundle.photos.failed ? null : bundle.photos.nextCursor,
      videoCursor: bundle.videos.failed ? null : bundle.videos.nextCursor,
      hasMorePhotos: bundle.photos.hasMore,
      hasMoreVideos: bundle.videos.hasMore,
    };
  }

  private usedOwnerUids(
    batches: readonly ExploreOwnerMediaBatchState[]
  ): string[] {
    const unique = new Set<string>();

    for (const batch of batches) {
      for (const uid of batch.ownerUids) {
        const normalized = String(uid ?? '').trim();
        if (normalized) unique.add(normalized);
      }
    }

    return [...unique];
  }

  private mergeMedia<T extends { readonly id: string; readonly ownerUid: string }>(
    current: readonly T[],
    incoming: readonly T[]
  ): T[] {
    const unique = new Map<string, T>();

    for (const item of [...current, ...incoming]) {
      const ownerUid = String(item?.ownerUid ?? '').trim();
      const id = String(item?.id ?? '').trim();
      const key = ownerUid && id ? `${ownerUid}:${id}` : '';
      if (!key || unique.has(key)) continue;
      unique.set(key, item);
    }

    return [...unique.values()];
  }

  private emptyState(
    viewerUid = '',
    loadingInitial = false
  ): ExplorePersonalMediaState {
    return {
      viewerUid,
      batches: [],
      personalPhotos: [],
      personalVideos: [],
      nextMediaBatchIndex: 0,
      loadingInitial,
      loadingMore: false,
      loadFailed: false,
    };
  }

  private emptyFriendPool(viewerUid = ''): ExploreFriendOwnerPool {
    return {
      viewerUid,
      ownerUids: [],
      initialized: false,
      loading: false,
      nextOrderValue: null,
      reachedEnd: false,
      error: null,
    };
  }

  private toFriendPool(
    viewerUid: string,
    slice: FriendsPageSlice | undefined
  ): ExploreFriendOwnerPool {
    if (!slice) {
      return this.emptyFriendPool(viewerUid);
    }

    return {
      viewerUid,
      ownerUids: this.normalizeFriendUids(slice.items),
      initialized: true,
      loading: !!slice.loading,
      nextOrderValue:
        typeof slice.nextOrderValue === 'number'
          ? slice.nextOrderValue
          : null,
      reachedEnd: !!slice.reachedEnd,
      error: slice.error ?? null,
    };
  }

  private sameFriendPool(
    left: ExploreFriendOwnerPool,
    right: ExploreFriendOwnerPool
  ): boolean {
    return (
      left.viewerUid === right.viewerUid &&
      this.sameStringArray(left.ownerUids, right.ownerUids) &&
      left.initialized === right.initialized &&
      left.loading === right.loading &&
      left.nextOrderValue === right.nextOrderValue &&
      left.reachedEnd === right.reachedEnd &&
      left.error === right.error
    );
  }

  private sameStringArray(
    left: readonly string[],
    right: readonly string[]
  ): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }

  private emptyBundle(): ExplorePersonalMediaPageBundle {
    return {
      photos: this.emptyPhotoPage(),
      videos: this.emptyVideoPage(),
    };
  }

  private emptyPhotoPage(): IPublicPhotoOwnerPage {
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
      failed: false,
      loadedAt: Date.now(),
    };
  }

  private emptyVideoPage(): IPublicVideoOwnerPage {
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
      failed: false,
      loadedAt: Date.now(),
    };
  }

  private ownerKey(ownerUids: readonly string[]): string {
    return ownerUids.join('|');
  }

  private normalizeFriendUids(items: readonly unknown[]): string[] {
    const unique = new Set<string>();

    for (const item of items ?? []) {
      const source = item as Record<string, unknown> | null;
      const uid = String(
        source?.['friendUid'] ?? source?.['uid'] ?? source?.['id'] ?? ''
      ).trim();

      if (uid) unique.add(uid);
    }

    return [...unique];
  }

  private withOwnerPhotoProfile(
    photo: IPublicPhotoItem,
    owner: IUserDados | null
  ): IPublicPhotoItem {
    if (!owner) return photo;

    return {
      ...photo,
      ownerNickname: owner.nickname ?? photo.ownerNickname ?? null,
      ownerPhotoURL: owner.photoURL ?? photo.ownerPhotoURL ?? null,
      ownerGender: owner.gender ?? photo.ownerGender ?? null,
      ownerOrientation: owner.orientation ?? photo.ownerOrientation ?? null,
      ownerMunicipio: owner.municipio ?? photo.ownerMunicipio ?? null,
      ownerEstado: owner.estado ?? photo.ownerEstado ?? null,
    };
  }

  private withOwnerVideoProfile(
    video: IPublicVideoItem,
    owner: IUserDados | null
  ): IPublicVideoItem {
    if (!owner) return video;

    return {
      ...video,
      owner: {
        nickname: owner.nickname ?? video.owner?.nickname ?? null,
        photoURL: owner.photoURL ?? video.owner?.photoURL ?? null,
        gender: owner.gender ?? video.owner?.gender ?? null,
        orientation: owner.orientation ?? video.owner?.orientation ?? null,
        municipio: owner.municipio ?? video.owner?.municipio ?? null,
        estado: owner.estado ?? video.owner?.estado ?? null,
      },
    };
  }

  private reportOwnerError(stage: string, error: unknown): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao carregar mídia pessoal do feed.');
      const contextual = normalized as Error & {
        context?: Record<string, unknown>;
        original?: unknown;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'ExplorePersonalMediaService',
        op: 'loadOwnerMedia',
        stage,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // O diagnóstico nunca deve interromper a paginação do feed.
    }
  }
}
