// src/app/dashboard/discovery/application/discovery-public-profiles.facade.ts
// -----------------------------------------------------------------------------
// DiscoveryPublicProfilesFacade
// -----------------------------------------------------------------------------
//
// Responsabilidades:
// - orquestrar a consulta paginada do modo "Todos";
// - expor estado visual reativo;
// - preservar presença como enriquecimento opcional;
// - delegar compatibilidade, distância, visibilidade, score e ordenação para
//   DiscoveryCardEnrichmentService;
// - nunca carregar a coleção inteira de public_profiles.
// -----------------------------------------------------------------------------

import {
  DestroyRef,
  Injectable,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';

import {
  Observable,
  combineLatest,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserPresenceQueryService } from 'src/app/core/services/data-handling/queries/user-presence.query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import {
  DEFAULT_DISCOVERY_PAGE_SIZE,
  DiscoveryFeedRequest,
  buildDiscoveryFeedQueryKey,
} from '../models/discovery-feed-page.model';
import { PublicProfileCard } from '../models/public-profile-card.model';
import { DiscoveryCardEnrichmentService } from './discovery-card-enrichment.service';

import * as DiscoveryActions from 'src/app/store/actions/actions.discovery/discovery-feed.actions';
import { selectDiscoveryFeedSlice } from 'src/app/store/selectors/selectors.discovery/discovery-feed.selectors';
import { AppState } from 'src/app/store/states/app.state';
import {
  DiscoveryFeedSlice,
  emptyDiscoveryFeedSlice,
} from 'src/app/store/states/states.discovery/discovery-feed.state';

export interface DiscoveryPublicProfilesState {
  readonly profiles: readonly PublicProfileCard[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly refreshing: boolean;
  readonly hasMore: boolean;
  readonly errorMessage: string | null;
}

const EMPTY_STATE: DiscoveryPublicProfilesState = {
  profiles: [],
  loading: false,
  loadingMore: false,
  refreshing: false,
  hasMore: false,
  errorMessage: null,
};

@Injectable({ providedIn: 'root' })
export class DiscoveryPublicProfilesFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(Store<AppState>);

  private readonly accessControl = inject(AccessControlService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly presenceQuery = inject(UserPresenceQueryService);
  private readonly cardEnrichment = inject(DiscoveryCardEnrichmentService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);

  private readonly request$: Observable<DiscoveryFeedRequest | null> =
    combineLatest([
      this.accessControl.authUid$,
      this.accessControl.canRunApp$,
    ]).pipe(
      map(([uid, canRunApp]) => {
        const viewerUid = this.toNullableText(uid);

        if (!viewerUid || !canRunApp) {
          return null;
        }

        return {
          viewerUid,
          mode: 'all' as const,
          pageSize: DEFAULT_DISCOVERY_PAGE_SIZE,
        };
      }),
      distinctUntilChanged((previous, current) =>
        this.requestKey(previous) === this.requestKey(current)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly feedSlice$: Observable<DiscoveryFeedSlice> =
    this.request$.pipe(
      switchMap((request) => {
        if (!request) {
          return of(emptyDiscoveryFeedSlice);
        }

        return this.store.select(
          selectDiscoveryFeedSlice(buildDiscoveryFeedQueryKey(request))
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly onlinePresenceByUid$ =
    this.getOnlinePresenceByUid$().pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly state$: Observable<DiscoveryPublicProfilesState> = combineLatest([
    this.request$,
    this.feedSlice$,
    this.currentUserStore.user$,
    this.onlinePresenceByUid$,
  ]).pipe(
    map(([request, slice, currentUser, onlinePresenceByUid]) => {
      if (!request) {
        return EMPTY_STATE;
      }

      /**
       * O store contém somente PublicProfileCard serializável e seguro.
       * DiscoveryCardEnrichmentService ainda tipa sua entrada como IUserDados,
       * mas consome exclusivamente os campos públicos presentes no card.
       * Esta adaptação é apenas de contrato TypeScript; nenhum campo privado é criado.
       */
      const enrichmentProfiles = slice.items as unknown as readonly IUserDados[];

      const result = this.cardEnrichment.buildCardsResult({
        profiles: enrichmentProfiles,
        currentUser: currentUser ?? null,
        currentUid: request.viewerUid,
        mode: request.mode,
        onlinePresenceByUid,
        applyVisibility: true,
      });

      return {
        profiles: result.profiles,
        loading: slice.loadingInitial && slice.items.length === 0,
        loadingMore: slice.loadingMore,
        refreshing: slice.refreshing,
        hasMore: !slice.reachedEnd,
        errorMessage: slice.error
          ? 'Não foi possível carregar os perfis agora.'
          : null,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly profiles$ = this.state$.pipe(
    map((state) => state.profiles)
  );

  readonly loading$ = this.state$.pipe(
    map((state) => state.loading)
  );

  readonly loadingMore$ = this.state$.pipe(
    map((state) => state.loadingMore)
  );

  readonly refreshing$ = this.state$.pipe(
    map((state) => state.refreshing)
  );

  readonly hasMore$ = this.state$.pipe(
    map((state) => state.hasMore)
  );

  readonly errorMessage$ = this.state$.pipe(
    map((state) => state.errorMessage)
  );

  constructor() {
    this.request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((request) => {
        if (!request) {
          this.store.dispatch(DiscoveryActions.clearDiscoveryFeeds());
          return;
        }

        this.store.dispatch(
          DiscoveryActions.loadDiscoveryFirstPage({ request })
        );
      });
  }

  loadMore(): void {
    this.withCurrentRequest((request) =>
      this.store.dispatch(
        DiscoveryActions.loadDiscoveryNextPage({ request })
      )
    );
  }

  refresh(): void {
    this.withCurrentRequest((request) =>
      this.store.dispatch(
        DiscoveryActions.refreshDiscoveryFeed({ request })
      )
    );
  }

  retry(): void {
    this.refresh();
  }

  private withCurrentRequest(
    callback: (request: DiscoveryFeedRequest) => void
  ): void {
    this.request$
      .pipe(take(1))
      .subscribe((request) => {
        if (request) {
          callback(request);
        }
      });
  }

  private getOnlinePresenceByUid$(): Observable<Map<string, IUserDados>> {
    return this.presenceQuery.getOnlineUsers$().pipe(
      startWith([] as IUserDados[]),
      map((onlineUsers) => {
        const byUid = new Map<string, IUserDados>();

        for (const user of onlineUsers ?? []) {
          const uid = this.toNullableText(user?.uid);

          if (uid) {
            byUid.set(uid, user);
          }
        }

        return byUid;
      }),
      catchError((error: unknown) => {
        const normalized = error instanceof Error
          ? error
          : new Error('Falha ao enriquecer presença da descoberta.');

        (normalized as any).skipUserNotification = true;
        (normalized as any).context =
          'DiscoveryPublicProfilesFacade.getOnlinePresenceByUid$';

        this.globalErrorHandler.handleError(normalized);
        return of(new Map<string, IUserDados>());
      })
    );
  }

  private requestKey(request: DiscoveryFeedRequest | null): string {
    return request ? buildDiscoveryFeedQueryKey(request) : 'none';
  }

  private toNullableText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const text = value.trim();
    return text.length ? text : null;
  }
}
