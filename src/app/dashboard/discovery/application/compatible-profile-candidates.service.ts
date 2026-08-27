// src/app/dashboard/discovery/application/compatible-profile-candidates.service.ts
// -----------------------------------------------------------------------------
// Pool compartilhado de candidatos compatíveis.
//
// Fonte canônica:
// NgRx Discovery V2 -> perfis públicos -> enriquecimento/compatibilidade -> UIDs.
//
// Privacidade:
// - o serviço não grava score ou preferência em perfil público;
// - dados do viewer são usados somente em memória pelo pipeline canônico;
// - `profiles$`/`ownerUids$` preservam a janela visual histórica de 12 perfis;
// - `pool$` expõe somente UIDs compatíveis acumulados + estado de paginação;
// - nenhuma URL de mídia entra no NgRx por este serviço.
// -----------------------------------------------------------------------------

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, combineLatest, of } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  skip,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import * as DiscoveryActions from 'src/app/store/actions/actions.discovery/discovery-feed.actions';
import { selectDiscoveryFeedSlice } from 'src/app/store/selectors/selectors.discovery/discovery-feed.selectors';
import type { AppState } from 'src/app/store/states/app.state';
import {
  DiscoveryFeedSlice,
  emptyDiscoveryFeedSlice,
} from 'src/app/store/states/states.discovery/discovery-feed.state';

import {
  DiscoveryFeedRequest,
  buildDiscoveryFeedQueryKey,
} from '../models/discovery-feed-page.model';
import type { PublicProfileCard } from '../models/public-profile-card.model';
import { DiscoveryCardEnrichmentService } from './discovery-card-enrichment.service';

const COMPATIBLE_CANDIDATE_PAGE_SIZE = 24;
const COMPATIBLE_CANDIDATE_TARGET = 12;

interface CompatibleCandidateProjection {
  readonly request: DiscoveryFeedRequest | null;
  readonly profiles: readonly PublicProfileCard[];
  readonly slice: DiscoveryFeedSlice;
  readonly shouldLoadMore: boolean;
}

export interface CompatibleProfileCandidatePool {
  readonly ownerUids: readonly string[];
  readonly hasMore: boolean;
  readonly loadingInitial: boolean;
  readonly loadingMore: boolean;
  readonly refreshing: boolean;
  readonly initialized: boolean;
  readonly error: string | null;
}

@Injectable({ providedIn: 'root' })
export class CompatibleProfileCandidatesService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(Store<AppState>);
  private readonly accessControl = inject(AccessControlService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly cardEnrichment = inject(DiscoveryCardEnrichmentService);

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
          mode: 'compatible' as const,
          pageSize: COMPATIBLE_CANDIDATE_PAGE_SIZE,
        };
      }),
      distinctUntilChanged(
        (previous, current) =>
          this.requestKey(previous) === this.requestKey(current)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly feedSlice$ = this.request$.pipe(
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

  private readonly candidateProjection$: Observable<CompatibleCandidateProjection> =
    combineLatest([
      this.request$,
      this.feedSlice$,
      this.currentUserStore.user$,
    ]).pipe(
      map(([request, slice, currentUser]): CompatibleCandidateProjection => {
        if (!request || !currentUser?.uid) {
          return {
            request,
            profiles: [],
            slice,
            shouldLoadMore: false,
          };
        }

        const result = this.cardEnrichment.buildCardsResult({
          profiles: slice.items as unknown as readonly IUserDados[],
          currentUser,
          currentUid: request.viewerUid,
          mode: request.mode,
          applyVisibility: true,
        });
        const profiles = [...result.profiles];

        return {
          request,
          profiles,
          slice,
          shouldLoadMore:
            profiles.length < COMPATIBLE_CANDIDATE_TARGET &&
            slice.items.length > 0 &&
            this.canLoadNext(slice),
        };
      }),
      tap(({ request, shouldLoadMore }) => {
        if (!request || !shouldLoadMore) {
          return;
        }

        this.store.dispatch(
          DiscoveryActions.loadDiscoveryNextPage({ request })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Janela visual histórica. Consumidores de cards continuam recebendo no
   * máximo 12 perfis para não aumentar custo/layout fora do feed social.
   */
  readonly profiles$: Observable<readonly PublicProfileCard[]> =
    this.candidateProjection$.pipe(
      map(({ profiles }) =>
        profiles.slice(0, COMPATIBLE_CANDIDATE_TARGET)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Projeção mínima histórica para consumidores de mídia que precisam apenas
   * da primeira janela de candidatos.
   */
  readonly ownerUids$: Observable<readonly string[]> = this.profiles$.pipe(
    map((profiles) => this.toOwnerUids(profiles, COMPATIBLE_CANDIDATE_TARGET)),
    distinctUntilChanged((previous, current) =>
      this.sameStringArray(previous, current)
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Pool acumulado para consumidores paginados, como `/descobrir`.
   * Não expõe score, preferência, dados privados nem URLs de mídia.
   */
  readonly pool$: Observable<CompatibleProfileCandidatePool> =
    this.candidateProjection$.pipe(
      map(({ request, profiles, slice }) => ({
        ownerUids: this.toOwnerUids(profiles),
        hasMore: this.hasMorePages(slice),
        loadingInitial: slice.loadingInitial,
        loadingMore: slice.loadingMore,
        refreshing: slice.refreshing,
        initialized: !!request && this.isInitialized(slice),
        error: slice.error,
      })),
      distinctUntilChanged((previous, current) =>
        this.samePool(previous, current)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  constructor() {
    this.request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((request) => {
        if (!request) return;

        this.store.dispatch(
          DiscoveryActions.loadDiscoveryFirstPage({ request })
        );
      });
  }

  /**
   * Solicita uma página adicional do Discovery V2 e resolve somente quando a
   * tentativa terminou. Quando a primeira página falhou antes de produzir um
   * cursor, refaz a primeira página em vez de tentar uma paginação impossível.
   */
  loadMore$(): Observable<boolean> {
    return this.candidateProjection$.pipe(
      take(1),
      switchMap(({ request, slice }) => {
        if (!request || !this.canRequestMore(slice)) {
          return of(false);
        }

        const beforeCount = slice.items.length;
        const retryFirstPage = this.canRetryFirstPage(slice);

        this.store.dispatch(
          retryFirstPage
            ? DiscoveryActions.loadDiscoveryFirstPage({ request })
            : DiscoveryActions.loadDiscoveryNextPage({ request })
        );

        return this.feedSlice$.pipe(
          // O dispatch do reducer é síncrono: a primeira emissão observada após
          // ele representa o estado de loading. A próxima emissão assentada é o
          // resultado real, inclusive quando a mensagem de erro se repete.
          skip(1),
          filter((next) =>
            !next.loadingInitial &&
            !next.loadingMore &&
            !next.refreshing
          ),
          take(1),
          map((next) => next.items.length > beforeCount)
        );
      })
    );
  }

  refresh(): void {
    this.request$.pipe(take(1)).subscribe((request) => {
      if (!request) return;

      this.store.dispatch(
        DiscoveryActions.refreshDiscoveryFeed({ request })
      );
    });
  }

  private canRequestMore(slice: DiscoveryFeedSlice): boolean {
    return this.canLoadNext(slice) || this.canRetryFirstPage(slice);
  }

  private canRetryFirstPage(slice: DiscoveryFeedSlice): boolean {
    return (
      !!slice.error &&
      slice.items.length === 0 &&
      slice.nextCursor === null &&
      !slice.reachedEnd &&
      !slice.loadingInitial &&
      !slice.loadingMore &&
      !slice.refreshing
    );
  }

  private canLoadNext(slice: DiscoveryFeedSlice): boolean {
    return (
      this.hasMorePages(slice) &&
      !slice.loadingInitial &&
      !slice.loadingMore &&
      !slice.refreshing
    );
  }

  private hasMorePages(slice: DiscoveryFeedSlice): boolean {
    return !slice.reachedEnd && slice.nextCursor !== null;
  }

  private isInitialized(slice: DiscoveryFeedSlice): boolean {
    return (
      slice.loadingInitial ||
      slice.loadingMore ||
      slice.refreshing ||
      slice.lastLoadedAt !== null ||
      slice.items.length > 0 ||
      slice.error !== null ||
      slice.reachedEnd
    );
  }

  private requestKey(request: DiscoveryFeedRequest | null): string {
    return request ? buildDiscoveryFeedQueryKey(request) : 'none';
  }

  private toOwnerUids(
    profiles: readonly PublicProfileCard[],
    limit = Number.POSITIVE_INFINITY
  ): string[] {
    const unique = new Set<string>();

    for (const profile of profiles) {
      const uid = this.toNullableText(profile?.uid);
      if (!uid) continue;

      unique.add(uid);
      if (unique.size >= limit) break;
    }

    return [...unique];
  }

  private samePool(
    left: CompatibleProfileCandidatePool,
    right: CompatibleProfileCandidatePool
  ): boolean {
    return (
      this.sameStringArray(left.ownerUids, right.ownerUids) &&
      left.hasMore === right.hasMore &&
      left.loadingInitial === right.loadingInitial &&
      left.loadingMore === right.loadingMore &&
      left.refreshing === right.refreshing &&
      left.initialized === right.initialized &&
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

  private toNullableText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const text = value.trim();
    return text.length ? text : null;
  }
}
