import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  defer,
  merge,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  ignoreElements,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';

import {
  IPublicPhotoRankingCursor,
  IPublicPhotoRankingPage,
  TPublicPhotoRankingMode,
} from 'src/app/core/interfaces/media/i-public-photo-ranking';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import {
  PhotoPromotionPlacement,
  PhotoPromotionPlacementService,
} from './photo-promotion-placement.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalActivityService } from 'src/app/core/services/network/global-activity.service';
import { NetworkStatusService } from 'src/app/core/services/network/network-status.service';
import { retryIdempotentRead } from 'src/app/core/services/network/network-retry.policy';
import {
  PublicMediaSnapshotKind,
  PublicMediaSnapshotService,
} from './public-media-snapshot.service';
import { PublicPhotoRankingQueryService } from './public-photo-ranking-query.service';

export interface PublicPhotoDiscoveryFeedState {
  readonly items: IPublicPhotoItem[];
  readonly nextCursor: IPublicPhotoRankingCursor | null;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly error: boolean;
  readonly stale: boolean;
  readonly sponsoredPlacement: PhotoPromotionPlacement | null;
}

const PUBLIC_PHOTO_DISCOVERY_PAGE_SIZE = 24;

@Injectable()
export class PublicPhotoDiscoveryFeedService {
  private readonly stateSubject =
    new BehaviorSubject<PublicPhotoDiscoveryFeedState>(this.emptyState());

  readonly state$: Observable<PublicPhotoDiscoveryFeedState> =
    this.stateSubject.asObservable().pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private mode: TPublicPhotoRankingMode | null = null;
  private initialized = false;
  private promotionRequested = false;

  constructor(
    private readonly ranking: PublicPhotoRankingQueryService,
    private readonly snapshots: PublicMediaSnapshotService,
    private readonly network: NetworkStatusService,
    private readonly activity: GlobalActivityService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly promotion: PhotoPromotionPlacementService
  ) {}

  connect$(
    mode: TPublicPhotoRankingMode
  ): Observable<PublicPhotoDiscoveryFeedState> {
    return defer(() => {
      this.bindMode(mode);

      const reconnectRefresh$ = this.network.reconnected$.pipe(
        switchMap(() => this.refresh$()),
        ignoreElements()
      );

      return merge(
        this.state$,
        this.initialize$().pipe(ignoreElements()),
        reconnectRefresh$
      );
    }).pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  loadMore$(): Observable<boolean> {
    return defer(() => {
      const mode = this.mode;
      const current = this.stateSubject.value;

      if (
        !mode ||
        current.loading ||
        current.stale ||
        !current.hasMore ||
        !current.nextCursor
      ) {
        return of(false);
      }

      this.stateSubject.next({
        ...current,
        loading: true,
        error: false,
      });

      return this.loadPage$(mode, current.nextCursor).pipe(
        tap((page) => {
          const latest = this.stateSubject.value;
          const items = this.mergeItems(latest.items, page.items);

          this.snapshots.write(this.snapshotKind(mode), items);
          this.stateSubject.next({
            ...latest,
            items,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
            loading: false,
            error: false,
            stale: false,
          });
        }),
        map(() => true),
        catchError(() => {
          const latest = this.stateSubject.value;

          this.errorNotifier.showWarning(
            'Não foi possível carregar mais fotos agora. Tente novamente.'
          );
          this.stateSubject.next({
            ...latest,
            loading: false,
            error: true,
            stale: latest.items.length > 0,
          });

          return of(false);
        })
      );
    });
  }

  refresh$(): Observable<boolean> {
    return defer(() => {
      if (!this.mode || this.stateSubject.value.loading) {
        return of(false);
      }

      return this.revalidateFirstPage$();
    });
  }

  private initialize$(): Observable<never> {
    if (this.initialized || !this.mode) {
      return EMPTY;
    }

    this.initialized = true;
    const mode = this.mode;

    return this.snapshots.read$(this.snapshotKind(mode)).pipe(
      catchError(() => of([] as IPublicPhotoItem[])),
      tap((cachedItems) => {
        this.stateSubject.next({
          items: [...cachedItems],
          nextCursor: null,
          hasMore: false,
          loading: true,
          error: false,
          stale: cachedItems.length > 0,
          sponsoredPlacement: null,
        });
      }),
      switchMap(() => this.revalidateFirstPage$()),
      ignoreElements()
    );
  }

  private revalidateFirstPage$(): Observable<boolean> {
    return defer(() => {
      const mode = this.mode;

      if (!mode) {
        return of(false);
      }

      const current = this.stateSubject.value;
      this.stateSubject.next({
        ...current,
        loading: true,
        error: false,
        stale: current.items.length > 0,
      });

      return this.loadPage$(mode, null).pipe(
        switchMap((page) => {
          const items = this.mergeItems([], page.items);

          this.snapshots.write(this.snapshotKind(mode), items);

          if (this.promotionRequested) {
            return of({
              page,
              items,
              sponsoredPlacement:
                this.stateSubject.value.sponsoredPlacement,
            });
          }

          this.promotionRequested = true;
          return this.promotion.loadPlacement$(items).pipe(
            map((sponsoredPlacement) => ({
              page,
              items,
              sponsoredPlacement,
            }))
          );
        }),
        tap(({ page, items, sponsoredPlacement }) => {
          this.stateSubject.next({
            items,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
            loading: false,
            error: false,
            stale: false,
            sponsoredPlacement,
          });
        }),
        map(() => true),
        catchError(() => {
          const latest = this.stateSubject.value;

          this.errorNotifier.showError(this.failureMessage(mode));
          this.stateSubject.next({
            ...latest,
            loading: false,
            error: true,
            stale: latest.items.length > 0,
          });

          return of(false);
        })
      );
    });
  }

  private loadPage$(
    mode: TPublicPhotoRankingMode,
    cursor: IPublicPhotoRankingCursor | null
  ): Observable<IPublicPhotoRankingPage> {
    return this.activity.track$(
      this.ranking.loadPage$({
        mode,
        pageSize: PUBLIC_PHOTO_DISCOVERY_PAGE_SIZE,
        cursor,
        propagateErrors: true,
      }).pipe(
        retryIdempotentRead({
          maximumRetries: 2,
          isOnline: () => this.network.isOnlineSnapshot(),
        })
      )
    );
  }

  private bindMode(mode: TPublicPhotoRankingMode): void {
    if (this.mode === mode) {
      return;
    }

    this.mode = mode;
    this.initialized = false;
    this.promotionRequested = false;
    this.stateSubject.next(this.emptyState());
  }

  private snapshotKind(
    mode: TPublicPhotoRankingMode
  ): PublicMediaSnapshotKind {
    if (mode === 'latest') {
      return 'latest-photos';
    }

    return 'top-photos';
  }

  private mergeItems(
    current: readonly IPublicPhotoItem[],
    incoming: readonly IPublicPhotoItem[]
  ): IPublicPhotoItem[] {
    const unique = new Map<string, IPublicPhotoItem>();

    for (const item of [...current, ...incoming]) {
      const ownerUid = String(item.ownerUid ?? '').trim();
      const id = String(item.id ?? '').trim();

      if (!ownerUid || !id) {
        continue;
      }

      unique.set(ownerUid + ':' + id, item);
    }

    return [...unique.values()];
  }

  private failureMessage(mode: TPublicPhotoRankingMode): string {
    if (mode === 'latest') {
      return 'Erro ao carregar últimas fotos públicas.';
    }

    return 'Erro ao carregar fotos em destaque.';
  }

  private emptyState(): PublicPhotoDiscoveryFeedState {
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
      loading: true,
      error: false,
      stale: false,
      sponsoredPlacement: null,
    };
  }
}
