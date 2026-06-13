//src\app\explore\services\explore-feed.service.ts
import { Injectable, inject } from '@angular/core';
import { combineLatest, Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { IExploreSection } from '../models/i-explore-section';

export interface IExploreFeedVm {
  readonly boostedPhotos: readonly IPublicPhotoItem[];
  readonly mostViewedPhotos: readonly IPublicPhotoItem[];
  readonly topPhotos: readonly IPublicPhotoItem[];
  readonly latestPhotos: readonly IPublicPhotoItem[];
  readonly sections: readonly IExploreSection<IPublicPhotoItem>[];
  readonly totalItems: number;
  readonly hasAnyContent: boolean;
}

@Injectable({ providedIn: 'root' })
export class ExploreFeedService {
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);

  readonly boostedPhotos$: Observable<IPublicPhotoItem[]> = this.mediaPublicQuery
    .getBoostedPublicPhotos$(8)
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  readonly topPhotos$: Observable<IPublicPhotoItem[]> = this.mediaPublicQuery
    .getTopPublicPhotos$(12)
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  private readonly publicPool$: Observable<IPublicPhotoItem[]> = this.mediaPublicQuery
    .getLatestPublicPhotos$(48)
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  readonly vm$: Observable<IExploreFeedVm> = combineLatest([
    this.boostedPhotos$,
    this.topPhotos$,
    this.publicPool$,
  ]).pipe(
    map(([boostedPhotos, topPhotos, publicPool]) => {
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
          description: 'Publicações impulsionadas artificialmente por destaque pago.',
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

      const visibleSections = sections.filter((section) => section.items.length > 0);

      const totalItems = visibleSections.reduce(
        (total, section) => total + section.items.length,
        0
      );

      return {
        boostedPhotos,
        mostViewedPhotos,
        topPhotos: safeTopPhotos,
        latestPhotos,
        sections: visibleSections,
        totalItems,
        hasAnyContent: totalItems > 0,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private rankByPublishedAt(items: readonly IPublicPhotoItem[]): IPublicPhotoItem[] {
    return [...items].sort(
      (a, b) => this.toNumber(b.publishedAt) - this.toNumber(a.publishedAt)
    );
  }

  private rankByEngagement(items: readonly IPublicPhotoItem[]): IPublicPhotoItem[] {
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
      (item) => this.toNumber(item.viewsCount) > 0 || this.toNumber(item.viewScore) > 0
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

  private toNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
}
