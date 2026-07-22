// src/app/dashboard/principal/principal-feed.service.ts
// -----------------------------------------------------------------------------
// Agregador reativo do fluxo principal.
//
// Fontes atuais:
// - últimas fotos públicas de perfis/casais;
// - descoberta de Comunidades;
// - descoberta de Locais.
//
// Cada fonte falha de forma isolada. O conteúdo saudável continua visível e o
// diagnóstico técnico segue para o GlobalErrorHandlerService sem expor detalhes.
// shareReplay funciona como cache reativo da sessão e refresh() invalida o lote.
// Comunidades e Locais respeitam integralmente a feature flag communityPreview.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import { CommunityPreviewRepository } from 'src/app/community/data-access/community-preview.repository';
import { isFeatureEnabled } from 'src/app/core/guards/access-guard/feature-flag.guard';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import {
  PRINCIPAL_FEED_LOADING_STATE,
  PrincipalFeedSource,
  PrincipalFeedState,
  buildPrincipalFeedItems,
} from './principal-feed.model';

interface FeedSourceResult<T> {
  readonly value: T;
  readonly failed: boolean;
}

const PHOTO_LIMIT = 12;
const SPACE_LIMIT = 4;
const SOCIAL_SPACES_ENABLED = isFeatureEnabled('communityPreview');

@Injectable({ providedIn: 'root' })
export class PrincipalFeedService {
  private readonly mediaQuery = inject(MediaPublicQueryService);
  private readonly communityRepository = inject(CommunityPreviewRepository);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly refreshSubject = new BehaviorSubject<void>(undefined);

  readonly state$: Observable<PrincipalFeedState> = this.refreshSubject.pipe(
    switchMap(() =>
      combineLatest([
        this.loadPhotos$(),
        this.loadSpaces$('community'),
        this.loadSpaces$('venue'),
      ]).pipe(
        map(([photosResult, communitiesResult, venuesResult]) => {
          const failedSources: PrincipalFeedSource[] = [];

          if (photosResult.failed) failedSources.push('profiles');
          if (communitiesResult.failed) failedSources.push('communities');
          if (venuesResult.failed) failedSources.push('venues');

          const photos = photosResult.value;
          const items = buildPrincipalFeedItems(
            photos,
            communitiesResult.value,
            venuesResult.value
          );
          const enabledSourceCount = SOCIAL_SPACES_ENABLED ? 3 : 1;
          const allEnabledSourcesFailed =
            failedSources.length === enabledSourceCount;

          return {
            status: allEnabledSourcesFailed
              ? 'error'
              : items.length > 0
                ? 'ready'
                : 'empty',
            items,
            photos,
            failedSources,
          } satisfies PrincipalFeedState;
        })
      )
    ),
    startWith(PRINCIPAL_FEED_LOADING_STATE),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  refresh(): void {
    this.refreshSubject.next();
  }

  private loadPhotos$(): Observable<FeedSourceResult<IPublicPhotoItem[]>> {
    return this.mediaQuery.getLatestPublicPhotos$(PHOTO_LIMIT).pipe(
      map((value) => ({ value: value ?? [], failed: false })),
      catchError((error: unknown) => {
        this.reportSourceError('profiles', error);
        return of({ value: [], failed: true });
      })
    );
  }

  private loadSpaces$(
    sourceType: 'community' | 'venue'
  ): Observable<FeedSourceResult<readonly CommunityPreviewCard[]>> {
    if (!SOCIAL_SPACES_ENABLED) {
      return of({ value: [], failed: false });
    }

    return this.communityRepository.getDiscoveryPage$({
      limit: SPACE_LIMIT,
      cursor: null,
      sourceType,
    }).pipe(
      map((page) => ({ value: page.items, failed: false })),
      catchError((error: unknown) => {
        this.reportSourceError(
          sourceType === 'community' ? 'communities' : 'venues',
          error
        );
        return of({ value: [], failed: true });
      })
    );
  }

  private reportSourceError(
    source: PrincipalFeedSource,
    error: unknown
  ): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao carregar uma fonte do fluxo principal.');
      const contextual = normalized as Error & {
        context?: Record<string, unknown>;
        original?: unknown;
        skipUserNotification?: boolean;
      };

      contextual.original = error;
      contextual.context = {
        scope: 'PrincipalFeedService',
        op: 'loadSource',
        source,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // A falha de diagnóstico não deve interromper as demais fontes.
    }
  }
}
