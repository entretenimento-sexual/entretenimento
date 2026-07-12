// src/app/explore/services/explore-feed.service.ts
// -----------------------------------------------------------------------------
// Feed social da área Explorar.
//
// Responsabilidades:
// - compor seções públicas de mídia;
// - enriquecer mídias apenas com projeções públicas dos proprietários;
// - consumir perfis compatíveis pela Discovery V2 paginada/NgRx;
// - não carregar integralmente public_profiles.
// -----------------------------------------------------------------------------

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { combineLatest, Observable, of } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { DiscoveryCardEnrichmentService } from 'src/app/dashboard/discovery/application/discovery-card-enrichment.service';
import {
  DiscoveryFeedRequest,
  buildDiscoveryFeedQueryKey,
} from 'src/app/dashboard/discovery/models/discovery-feed-page.model';
import { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';
import * as DiscoveryActions from 'src/app/store/actions/actions.discovery/discovery-feed.actions';
import { selectDiscoveryFeedSlice } from 'src/app/store/selectors/selectors.discovery/discovery-feed.selectors';
import { AppState } from 'src/app/store/states/app.state';
import { emptyDiscoveryFeedSlice } from 'src/app/store/states/states.discovery/discovery-feed.state';

import { IExploreSection } from '../models/i-explore-section';

const EXPLORE_COMPATIBLE_PAGE_SIZE = 24;
const EXPLORE_COMPATIBLE_VISIBLE_LIMIT = 6;

export interface IExploreFeedVm {
  readonly boostedPhotos: readonly IPublicPhotoItem[];
  readonly mostViewedPhotos: readonly IPublicPhotoItem[];
  readonly topPhotos: readonly IPublicPhotoItem[];
  readonly latestPhotos: readonly IPublicPhotoItem[];
  readonly sections: readonly IExploreSection<IPublicPhotoItem>[];
  readonly compatibleProfiles: readonly PublicProfileCard[];
  readonly totalItems: number;
  readonly hasAnyContent: boolean;
}

interface CompatibleProfilesProjection {
  readonly request: DiscoveryFeedRequest | null;
  readonly profiles: readonly PublicProfileCard[];
  readonly shouldLoadMore: boolean;
}

@Injectable({ providedIn: 'root' })
export class ExploreFeedService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(Store<AppState>);
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly discoveryQuery = inject(UserDiscoveryQueryService);
  private readonly accessControl = inject(AccessControlService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly cardEnrichment = inject(DiscoveryCardEnrichmentService);

  /**
   * Consulta independente do modo "Todos".
   *
   * A chave inclui viewer, modo e tamanho, portanto as duas superfícies podem
   * compartilhar o mesmo slice NgRx sem misturar páginas ou cache.
   */
  private readonly compatibleRequest$: Observable<DiscoveryFeedRequest | null> =
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
          pageSize: EXPLORE_COMPATIBLE_PAGE_SIZE,
        };
      }),
      distinctUntilChanged(
        (previous, current) =>
          this.requestKey(previous) === this.requestKey(current)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly compatibleFeedSlice$ = this.compatibleRequest$.pipe(
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

  readonly boostedPhotos$: Observable<IPublicPhotoItem[]> =
    this.mediaPublicQuery.getBoostedPublicPhotos$(8).pipe(
      switchMap((photos) => this.enrichPublicPhotos$(photos)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly topPhotos$: Observable<IPublicPhotoItem[]> =
    this.mediaPublicQuery.getTopPublicPhotos$(12).pipe(
      switchMap((photos) => this.enrichPublicPhotos$(photos)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly publicPool$: Observable<IPublicPhotoItem[]> =
    this.mediaPublicQuery.getLatestPublicPhotos$(48).pipe(
      switchMap((photos) => this.enrichPublicPhotos$(photos)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * O Explore mostra no máximo seis perfis.
   *
   * Caso a página atual tenha poucos candidatos aceitos após compatibilidade
   * mútua e visibilidade, solicita a próxima página pelo mesmo fluxo NgRx até:
   * - completar seis cards; ou
   * - alcançar o fim da consulta.
   */
  readonly compatibleProfiles$: Observable<PublicProfileCard[]> = combineLatest([
    this.compatibleRequest$,
    this.compatibleFeedSlice$,
    this.currentUserStore.user$,
  ]).pipe(
    map(([request, slice, currentUser]): CompatibleProfilesProjection => {
      if (!request || !currentUser?.uid) {
        return {
          request,
          profiles: [],
          shouldLoadMore: false,
        };
      }

      const sourceProfiles = slice.items as unknown as readonly IUserDados[];
      const result = this.cardEnrichment.buildCardsResult({
        profiles: sourceProfiles,
        currentUser,
        currentUid: request.viewerUid,
        mode: request.mode,
        applyVisibility: true,
      });
      const profiles = result.profiles.slice(
        0,
        EXPLORE_COMPATIBLE_VISIBLE_LIMIT
      );

      return {
        request,
        profiles,
        shouldLoadMore:
          profiles.length < EXPLORE_COMPATIBLE_VISIBLE_LIMIT &&
          slice.items.length > 0 &&
          slice.nextCursor !== null &&
          !slice.reachedEnd &&
          !slice.loadingInitial &&
          !slice.loadingMore &&
          !slice.refreshing,
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
    map(({ profiles }) => [...profiles]),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly vm$: Observable<IExploreFeedVm> = combineLatest([
    this.boostedPhotos$,
    this.topPhotos$,
    this.publicPool$,
    this.compatibleProfiles$,
  ]).pipe(
    map(([boostedPhotos, topPhotos, publicPool, compatibleProfiles]) => {
      const latestPhotos = this.rankByPublishedAt(publicPool).slice(0, 16);

      const safeTopPhotos =
        topPhotos.length > 0
          ? topPhotos
          : this.rankByEngagement(publicPool).slice(0, 12);

      const mostViewedPhotos = this.rankByViews(publicPool).slice(0, 12);

      const sections: IExploreSection<IPublicPhotoItem>[] = [
        {
          id: 'boosted',
          kind: 'photos',
          eyebrow: 'Turbo',
          title: 'Fotos turbinadas',
          description: 'Publicações impulsionadas por destaque pago.',
          note: 'Impulsionadas',
          items: boostedPhotos,
          routeCommands: ['/media', 'fotos-turbinadas'],
        },
        {
          id: 'mostViewed',
          kind: 'photos',
          eyebrow: 'Visualizações',
          title: 'Mídias mais vistas',
          description: 'Fotos com maior sinal público de visualização.',
          note: 'Mais vistas',
          items: mostViewedPhotos,
        },
        {
          id: 'top',
          kind: 'photos',
          eyebrow: topPhotos.length > 0 ? 'Destaques' : 'Sugestões',
          title: topPhotos.length > 0 ? 'Top fotos' : 'Fotos para descobrir',
          description:
            topPhotos.length > 0
              ? 'Fotos públicas ordenadas por engajamento.'
              : 'Fotos públicas disponíveis para começar a explorar.',
          note: topPhotos.length > 0 ? 'Maior engajamento' : 'Disponíveis agora',
          items: safeTopPhotos,
          routeCommands: ['/media', 'fotos-top'],
        },
        {
          id: 'latest',
          kind: 'photos',
          eyebrow: 'Atualizações',
          title: 'Últimas fotos',
          description: 'Publicações públicas ordenadas por data de publicação.',
          note: 'Mais recentes',
          items: latestPhotos,
          routeCommands: ['/media', 'ultimas-fotos'],
        },
      ];

      const visibleSections = sections.filter(
        (section) => section.items.length > 0
      );

      const totalItems =
        compatibleProfiles.length +
        visibleSections.reduce(
          (total, section) => total + section.items.length,
          0
        );

      return {
        boostedPhotos,
        mostViewedPhotos,
        topPhotos: safeTopPhotos,
        latestPhotos,
        compatibleProfiles,
        sections: visibleSections,
        totalItems,
        hasAnyContent: totalItems > 0,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    this.compatibleRequest$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((request) => {
        if (!request) {
          return;
        }

        this.store.dispatch(
          DiscoveryActions.loadDiscoveryFirstPage({ request })
        );
      });
  }

  private rankByPublishedAt(
    items: readonly IPublicPhotoItem[]
  ): IPublicPhotoItem[] {
    return [...items].sort(
      (a, b) => this.toNumber(b.publishedAt) - this.toNumber(a.publishedAt)
    );
  }

  private rankByEngagement(
    items: readonly IPublicPhotoItem[]
  ): IPublicPhotoItem[] {
    return [...items].sort((a, b) => {
      const diff = this.getEngagementScore(b) - this.getEngagementScore(a);

      if (diff !== 0) {
        return diff;
      }

      return this.toNumber(b.publishedAt) - this.toNumber(a.publishedAt);
    });
  }

  private rankByViews(items: readonly IPublicPhotoItem[]): IPublicPhotoItem[] {
    const hasViewMetrics = items.some(
      (item) =>
        this.toNumber(item.viewsCount) > 0 ||
        this.toNumber(item.viewScore) > 0
    );

    if (!hasViewMetrics) {
      return [];
    }

    return [...items].sort((a, b) => {
      const diff = this.getViewScore(b) - this.getViewScore(a);

      if (diff !== 0) {
        return diff;
      }

      return this.toNumber(b.publishedAt) - this.toNumber(a.publishedAt);
    });
  }

  private getEngagementScore(item: IPublicPhotoItem): number {
    const explicitScore = this.toNumber(item.engagementScore ?? item.score);

    if (explicitScore > 0) {
      return explicitScore;
    }

    return (
      this.toNumber(item.reactionsCount ?? item.likesCount) * 3 +
      this.toNumber(item.commentsCount) * 5 +
      this.toNumber(item.publishedAt) / 1_000_000_000
    );
  }

  private getViewScore(item: IPublicPhotoItem): number {
    const explicitScore = this.toNumber(item.viewScore);

    if (explicitScore > 0) {
      return explicitScore;
    }

    return (
      this.toNumber(item.viewsCount) * 4 +
      this.toNumber(item.uniqueViewersCount) * 6 +
      this.toNumber(item.lastViewedAt) / 1_000_000_000
    );
  }

  private enrichPublicPhotos$(
    photos: readonly IPublicPhotoItem[]
  ): Observable<IPublicPhotoItem[]> {
    const ownerUids = Array.from(
      new Set(
        (photos ?? [])
          .map((photo) => photo.ownerUid)
          .filter(
            (uid): uid is string =>
              typeof uid === 'string' && uid.trim().length > 0
          )
      )
    );

    if (!ownerUids.length) {
      return of([...(photos ?? [])]);
    }

    return this.discoveryQuery
      .getProfilesByUids$(ownerUids, { cacheTTL: 300_000 })
      .pipe(
        map((profiles) => {
          const byUid = new Map<string, IUserDados>();

          for (const profile of profiles ?? []) {
            if (profile?.uid) {
              byUid.set(profile.uid, profile);
            }
          }

          return (photos ?? []).map((photo) =>
            this.withOwnerProfile(
              photo,
              byUid.get(photo.ownerUid) ?? null
            )
          );
        })
      );
  }

  private withOwnerProfile(
    photo: IPublicPhotoItem,
    owner: IUserDados | null
  ): IPublicPhotoItem {
    if (!owner) {
      return photo;
    }

    return {
      ...photo,
      ownerNickname: owner.nickname ?? null,
      ownerPhotoURL: owner.photoURL ?? null,
      ownerGender: owner.gender ?? null,
      ownerOrientation: owner.orientation ?? null,
      ownerMunicipio: owner.municipio ?? null,
      ownerEstado: owner.estado ?? null,
    };
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

  private toNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
}
