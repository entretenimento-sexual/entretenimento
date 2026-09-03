import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import type { GeoCoordinates } from 'src/app/core/interfaces/geolocation.interface';
import type { DiscoveryPreferenceRejectionReason } from 'src/app/core/utils/discovery/profile-type-preference-filter.util';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserPresenceQueryService } from 'src/app/core/services/data-handling/queries/user-presence.query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { GeolocationTrackingService } from 'src/app/core/services/geolocation/geolocation-tracking.service';
import * as DiscoveryActions from 'src/app/store/actions/actions.discovery/discovery-feed.actions';
import { selectDiscoveryFeedSlice } from 'src/app/store/selectors/selectors.discovery/discovery-feed.selectors';
import type { AppState } from 'src/app/store/states/app.state';
import {
  DiscoveryFeedSlice,
  emptyDiscoveryFeedSlice,
} from 'src/app/store/states/states.discovery/discovery-feed.state';

import {
  DEFAULT_DISCOVERY_PAGE_SIZE,
  DiscoveryFeedRequest,
  buildDiscoveryFeedQueryKey,
} from '../models/discovery-feed-page.model';
import type { PublicProfileCard } from '../models/public-profile-card.model';
import {
  DiscoveryCardEnrichmentService,
  type DiscoveryCardEnrichmentResult,
} from './discovery-card-enrichment.service';
import {
  DiscoveryVisibleProfileLocationRepository,
  type DiscoveryVisibleProfileLocation,
} from '../data-access/discovery-visible-profile-location.repository';

export interface DiscoveryPublicProfilesState {
  readonly profiles: readonly PublicProfileCard[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly refreshing: boolean;
  readonly hasMore: boolean;
  readonly errorMessage: string | null;
  readonly emptyMessage: string;
  readonly filteredByPreferences: boolean;
}

const EMPTY_STATE: DiscoveryPublicProfilesState = {
  profiles: [],
  loading: false,
  loadingMore: false,
  refreshing: false,
  hasMore: false,
  errorMessage: null,
  emptyMessage: 'Nenhum perfil disponível agora.',
  filteredByPreferences: false,
};

const PREFERENCE_REJECTION_REASONS = new Set<DiscoveryPreferenceRejectionReason>([
  'couples_disabled',
  'singles_disabled',
  'trans_profiles_disabled',
  'profile_type_not_selected',
  'age_missing',
  'age_out_of_range',
  'location_required',
  'outside_max_distance',
  'relationship_intent_missing',
  'relationship_intent_mismatch',
  'sexual_practice_missing',
  'sexual_practice_mismatch',
  'body_trait_missing',
  'body_trait_mismatch',
  'reciprocal_mismatch',
]);

/**
 * Facade reativo da página /dashboard/explorar.
 *
 * O provider é deliberadamente definido na rota, não no root injector. Dessa
 * forma, DestroyRef encerra presença, localização, overlays e recomposição dos
 * cards assim que o usuário sai do Explorar, enquanto o cache NgRx permanece
 * disponível para a plataforma.
 */
@Injectable()
export class DiscoveryPublicProfilesFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(Store<AppState>);
  private readonly accessControl = inject(AccessControlService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly presenceQuery = inject(UserPresenceQueryService);
  private readonly cardEnrichment = inject(DiscoveryCardEnrichmentService);
  private readonly geolocationTracking = inject(GeolocationTrackingService);
  private readonly visibleLocationRepository = inject(
    DiscoveryVisibleProfileLocationRepository
  );
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  /**
   * O cache contém apenas perfis públicos brutos. As preferências do viewer são
   * reaplicadas reativamente na composição do estado e não alteram a chave da
   * consulta paginada.
   */
  private readonly request$: Observable<DiscoveryFeedRequest | null> = combineLatest([
    this.accessControl.authUid$,
    this.accessControl.canRunApp$,
  ]).pipe(
    map(([uid, canRunApp]) => {
      const viewerUid = this.toNullableText(uid);
      return viewerUid && canRunApp
        ? { viewerUid, mode: 'all' as const, pageSize: DEFAULT_DISCOVERY_PAGE_SIZE }
        : null;
    }),
    distinctUntilChanged((a, b) => this.requestKey(a) === this.requestKey(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly feedSlice$: Observable<DiscoveryFeedSlice> = this.request$.pipe(
    switchMap((request) => request
      ? this.store.select(selectDiscoveryFeedSlice(buildDiscoveryFeedQueryKey(request)))
      : of(emptyDiscoveryFeedSlice)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly onlinePresenceByUid$ = this.getOnlinePresenceByUid$().pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Posição local do viewer em tempo real.
   *
   * O BehaviorSubject do tracking faz a descoberta recalcular as distâncias
   * imediatamente quando o navegador entrega uma nova posição, sem depender de
   * refresh do feed ou de outra emissão do NgRx.
   */
  private readonly viewerLocation$ = this.geolocationTracking.snapshot$.pipe(
    distinctUntilChanged((a, b) => this.sameCoordinates(a, b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Overlay realtime somente dos UIDs já carregados.
   *
   * Mantemos ranking/paginação one-shot, mas localização pública dos cards
   * visíveis acompanha alterações de public_profiles sem reordenar o feed.
   */
  private readonly liveLocationsByUid$ = this.feedSlice$.pipe(
    map((slice) =>
      Array.from(
        new Set(
          (slice.items ?? [])
            .map((item) => this.toNullableText(item?.uid))
            .filter((uid): uid is string => !!uid)
        )
      ).sort()
    ),
    distinctUntilChanged((a, b) => this.sameStringArray(a, b)),
    switchMap((uids) =>
      uids.length
        ? this.visibleLocationRepository.watchByUids$(uids)
        : of([] as readonly DiscoveryVisibleProfileLocation[])
    ),
    map(
      (locations) =>
        new Map<string, DiscoveryVisibleProfileLocation>(
          locations.map((location) => [location.uid, location])
        )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$: Observable<DiscoveryPublicProfilesState> = combineLatest([
    this.request$,
    this.feedSlice$,
    this.currentUserStore.user$,
    this.onlinePresenceByUid$,
    this.viewerLocation$,
    this.liveLocationsByUid$,
  ]).pipe(
    map(([
      request,
      slice,
      currentUser,
      onlinePresenceByUid,
      viewerLocation,
      liveLocationsByUid,
    ]) => {
      if (!request) return EMPTY_STATE;

      /**
       * A posição runtime pertence ao viewer e serve apenas como origem do
       * cálculo local. A projeção pública dos cards é derivada no backend.
       */
      const runtimeViewerLocation =
        viewerLocation ?? this.geolocationTracking.getLastSnapshot();

      const profilesWithLiveLocations = (
        slice.items as unknown as readonly IUserDados[]
      ).map((profile) =>
        this.overlayLivePublicLocation(profile, liveLocationsByUid)
      );

      const result = this.cardEnrichment.buildCardsResult({
        profiles: profilesWithLiveLocations,
        currentUser: currentUser ?? null,
        currentUid: request.viewerUid,
        mode: request.mode,
        fallbackLocation: runtimeViewerLocation,
        onlinePresenceByUid,
        applyVisibility: true,
      });
      const filteredByPreferences = this.wasFilteredByPreferences(result);

      return {
        profiles: result.profiles,
        loading: slice.loadingInitial && slice.items.length === 0,
        loadingMore: slice.loadingMore,
        refreshing: slice.refreshing,
        hasMore: !slice.reachedEnd,
        errorMessage: slice.error ? 'Não foi possível carregar os perfis agora.' : null,
        emptyMessage: filteredByPreferences
          ? 'Nenhum perfil corresponde aos filtros desta página.'
          : 'Nenhum perfil disponível agora.',
        filteredByPreferences,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly profiles$ = this.state$.pipe(map((state) => state.profiles));
  readonly loading$ = this.state$.pipe(map((state) => state.loading));
  readonly loadingMore$ = this.state$.pipe(map((state) => state.loadingMore));
  readonly refreshing$ = this.state$.pipe(map((state) => state.refreshing));
  readonly hasMore$ = this.state$.pipe(map((state) => state.hasMore));
  readonly errorMessage$ = this.state$.pipe(map((state) => state.errorMessage));
  readonly emptyMessage$ = this.state$.pipe(map((state) => state.emptyMessage));
  readonly filteredByPreferences$ = this.state$.pipe(
    map((state) => state.filteredByPreferences)
  );

  constructor() {
    this.request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((request) => {
      if (!request) {
        this.store.dispatch(DiscoveryActions.clearDiscoveryFeeds());
        return;
      }
      this.store.dispatch(DiscoveryActions.loadDiscoveryFirstPage({ request }));
    });
  }

  loadMore(): void {
    this.withCurrentRequest((request) =>
      this.store.dispatch(DiscoveryActions.loadDiscoveryNextPage({ request }))
    );
  }

  refresh(): void {
    this.withCurrentRequest((request) =>
      this.store.dispatch(DiscoveryActions.refreshDiscoveryFeed({ request }))
    );
  }

  retry(): void {
    this.refresh();
  }

  private overlayLivePublicLocation(
    profile: IUserDados,
    locationsByUid: ReadonlyMap<string, DiscoveryVisibleProfileLocation>
  ): IUserDados {
    const uid = this.toNullableText(profile?.uid);
    if (!uid) return profile;

    const liveLocation = locationsByUid.get(uid);
    if (!liveLocation) return profile;

    return {
      ...profile,
      latitude: liveLocation.latitude,
      longitude: liveLocation.longitude,
      geohash: liveLocation.geohash,
    } as IUserDados;
  }

  private wasFilteredByPreferences(
    result: DiscoveryCardEnrichmentResult
  ): boolean {
    if (result.profiles.length > 0 || result.rejected.length === 0) {
      return false;
    }

    return result.rejected.some((item) =>
      PREFERENCE_REJECTION_REASONS.has(
        item.reason as DiscoveryPreferenceRejectionReason
      )
    );
  }

  private withCurrentRequest(callback: (request: DiscoveryFeedRequest) => void): void {
    this.request$.pipe(take(1)).subscribe((request) => {
      if (request) callback(request);
    });
  }

  private getOnlinePresenceByUid$(): Observable<Map<string, IUserDados>> {
    return this.presenceQuery.getOnlineUsers$().pipe(
      startWith([] as IUserDados[]),
      map((users) => new Map(
        (users ?? [])
          .map((user) => [this.toNullableText(user?.uid), user] as const)
          .filter((entry): entry is readonly [string, IUserDados] => !!entry[0])
      )),
      catchError((error: unknown) => {
        const normalized = error instanceof Error
          ? error
          : new Error('Falha ao enriquecer presença da descoberta.');
        (normalized as Error & { skipUserNotification?: boolean }).skipUserNotification = true;
        (normalized as Error & { context?: string }).context =
          'DiscoveryPublicProfilesFacade.getOnlinePresenceByUid$';
        this.globalErrorHandler.handleError(normalized);
        return of(new Map<string, IUserDados>());
      })
    );
  }

  private sameCoordinates(
    a: GeoCoordinates | null,
    b: GeoCoordinates | null
  ): boolean {
    if (a === b) return true;
    if (!a || !b) return false;

    return (
      a.latitude === b.latitude &&
      a.longitude === b.longitude &&
      a.accuracy === b.accuracy
    );
  }

  private sameStringArray(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  private requestKey(request: DiscoveryFeedRequest | null): string {
    return request ? buildDiscoveryFeedQueryKey(request) : 'none';
  }

  private toNullableText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
