// src/app/explore/services/explore-feed.service.ts
// -----------------------------------------------------------------------------
// Feed social da área Explorar.
//
// Responsabilidades:
// - compor seções públicas de mídia;
// - enriquecer mídias apenas com projeções públicas dos proprietários;
// - consumir o pool compatível compartilhado da Discovery V2/NgRx;
// - não carregar integralmente public_profiles;
// - manter URLs assinadas de vídeo fora do NgRx e limitadas ao cache em memória.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, combineLatest, Observable, of } from 'rxjs';
import {
  catchError,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import {
  IPublicVideoRankingPage,
  TPublicVideoRankingMode,
} from 'src/app/core/interfaces/media/i-public-video-ranking';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { PublicVideoRankingQueryService } from 'src/app/core/services/media/public-video-ranking-query.service';
import { CompatibleProfileCandidatesService } from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
import { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';

import { IExploreSection } from '../models/i-explore-section';

const EXPLORE_COMPATIBLE_VISIBLE_LIMIT = 6;
const EXPLORE_VIDEO_RANKING_PAGE_SIZE = 4;
const EXPLORE_VIDEO_VISIBLE_LIMIT = 6;

export type TExploreVideoHighlightsStatus =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error';

export interface IExploreVideoHighlightsState {
  readonly status: TExploreVideoHighlightsStatus;
  readonly items: readonly IPublicVideoItem[];
}

export interface IExploreFeedVm {
  readonly boostedPhotos: readonly IPublicPhotoItem[];
  readonly mostViewedPhotos: readonly IPublicPhotoItem[];
  readonly topPhotos: readonly IPublicPhotoItem[];
  readonly latestPhotos: readonly IPublicPhotoItem[];
  readonly videoHighlights: readonly IPublicVideoItem[];
  readonly videoHighlightsStatus: TExploreVideoHighlightsStatus;
  readonly sections: readonly IExploreSection<IPublicPhotoItem>[];
  readonly compatibleProfiles: readonly PublicProfileCard[];
  readonly totalItems: number;
  readonly hasAnyContent: boolean;
}

@Injectable({ providedIn: 'root' })
export class ExploreFeedService {
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);
  private readonly publicVideoRanking = inject(PublicVideoRankingQueryService);
  private readonly discoveryQuery = inject(UserDiscoveryQueryService);
  private readonly compatibleCandidates = inject(CompatibleProfileCandidatesService);
  private readonly videoHighlightsRefreshSubject = new BehaviorSubject<number>(0);

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
   * Destaques de vídeo permanecem deliberadamente fora do NgRx porque contêm
   * URLs assinadas de curta duração. O ranking "top" é hidratado antes de
   * "latest" para que vídeos repetidos reutilizem o acesso temporário que já
   * está no cache em memória do PublicVideoAccessService.
   *
   * Cada fonte falha isoladamente: uma indisponibilidade parcial não remove os
   * vídeos obtidos pela outra consulta. O estado vira "error" apenas quando as
   * duas fontes falham.
   */
  readonly videoHighlightsState$: Observable<IExploreVideoHighlightsState> =
    this.videoHighlightsRefreshSubject.pipe(
      switchMap(() =>
        this.loadVideoRankingPage$('top').pipe(
          switchMap((topPage) =>
            this.loadVideoRankingPage$('latest').pipe(
              map((latestPage) =>
                this.buildVideoHighlightsState(topPage, latestPage)
              )
            )
          ),
          startWith<IExploreVideoHighlightsState>({
            status: 'loading',
            items: [],
          })
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * O pool compatível é compartilhado com outras superfícies. O Explore mantém
   * sua decisão visual histórica de mostrar no máximo seis perfis.
   */
  readonly compatibleProfiles$: Observable<PublicProfileCard[]> =
    this.compatibleCandidates.profiles$.pipe(
      map((profiles) => [
        ...profiles.slice(0, EXPLORE_COMPATIBLE_VISIBLE_LIMIT),
      ]),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly vm$: Observable<IExploreFeedVm> = combineLatest([
    this.boostedPhotos$,
    this.topPhotos$,
    this.publicPool$,
    this.videoHighlightsState$,
    this.compatibleProfiles$,
  ]).pipe(
    map(([
      boostedPhotos,
      topPhotos,
      publicPool,
      videoHighlightsState,
      compatibleProfiles,
    ]) => {
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
        videoHighlightsState.items.length +
        visibleSections.reduce(
          (total, section) => total + section.items.length,
          0
        );

      return {
        boostedPhotos,
        mostViewedPhotos,
        topPhotos: safeTopPhotos,
        latestPhotos,
        videoHighlights: videoHighlightsState.items,
        videoHighlightsStatus: videoHighlightsState.status,
        compatibleProfiles,
        sections: visibleSections,
        totalItems,
        hasAnyContent: totalItems > 0,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retryVideoHighlights(): void {
    this.videoHighlightsRefreshSubject.next(
      this.videoHighlightsRefreshSubject.value + 1
    );
  }

  private loadVideoRankingPage$(
    mode: TPublicVideoRankingMode
  ): Observable<IPublicVideoRankingPage | null> {
    return this.publicVideoRanking.loadPage$({
      mode,
      pageSize: EXPLORE_VIDEO_RANKING_PAGE_SIZE,
      propagateErrors: true,
    }).pipe(
      catchError(() => of(null))
    );
  }

  private buildVideoHighlightsState(
    topPage: IPublicVideoRankingPage | null,
    latestPage: IPublicVideoRankingPage | null
  ): IExploreVideoHighlightsState {
    const items = this.mergeVideoHighlights(
      topPage?.items ?? [],
      latestPage?.items ?? [],
      EXPLORE_VIDEO_VISIBLE_LIMIT
    );

    if (items.length > 0) {
      return { status: 'ready', items };
    }

    if (!topPage && !latestPage) {
      return { status: 'error', items: [] };
    }

    return { status: 'empty', items: [] };
  }

  private mergeVideoHighlights(
    topItems: readonly IPublicVideoItem[],
    latestItems: readonly IPublicVideoItem[],
    limit: number
  ): IPublicVideoItem[] {
    const result: IPublicVideoItem[] = [];
    const seen = new Set<string>();
    const maxLength = Math.max(topItems.length, latestItems.length);

    for (let index = 0; index < maxLength && result.length < limit; index += 1) {
      for (const item of [topItems[index], latestItems[index]]) {
        if (!item || result.length >= limit) {
          continue;
        }

        const key = `${item.ownerUid}:${item.id}`;
        if (!item.ownerUid || !item.id || seen.has(key)) {
          continue;
        }

        seen.add(key);
        result.push(item);
      }
    }

    return result;
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

  private toNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
}
