// src/app/dashboard/principal/principal-feed.service.ts
// -----------------------------------------------------------------------------
// Agregador reativo do fluxo principal.
//
// Fontes atuais:
// - últimas fotos públicas;
// - vídeos públicos recentes via ranking/cursor canônico, hidratados como preview;
// - mídia recente personalizada (conexões + compatíveis) em lote e sem N+1;
// - novidade baseada apenas em "esta mídia foi vista recentemente";
// - descoberta de Comunidades;
// - descoberta de Locais.
//
// Reatividade:
// - sessão e refresh iniciam um novo ciclo completo;
// - mudança realtime de conexões ou do pool compatível refaz apenas o contexto
//   de mídia e a checagem de novidade;
// - Comunidades/Locais não refazem a checagem de views;
// - cada fonte falha de forma isolada;
// - shareReplay mantém cache de sessão sem criar assinatura permanente.
//
// Privacidade:
// - amizade/compatibilidade só alteram a composição privada da home do viewer;
// - a home consome apenas UIDs já aprovados pelo pipeline de compatibilidade;
// - histórico de consumo não vira afinidade, categoria ou preferência implícita;
// - o backend devolve somente quais candidatos atuais foram vistos recentemente;
// - nenhum score público é alterado;
// - vídeos personalizados continuam preview-only até abertura do viewer;
// - autorização final de foto/vídeo continua no backend de mídia.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import { CommunityPreviewRepository } from 'src/app/community/data-access/community-preview.repository';
import { isFeatureEnabled } from 'src/app/core/guards/access-guard/feature-flag.guard';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import {
  IPublicMediaRecentViewCandidate,
  PublicMediaRecentViewService,
} from 'src/app/core/services/media/public-media-recent-view.service';
import { PublicVideoRankingQueryService } from 'src/app/core/services/media/public-video-ranking-query.service';
import { CompatibleProfileCandidatesService } from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
import {
  PRINCIPAL_FEED_LOADING_STATE,
  PrincipalFeedItem,
  PrincipalFeedSource,
  PrincipalFeedState,
  buildPrincipalFeedItems,
} from './principal-feed.model';

interface FeedSourceResult<T> {
  readonly value: T;
  readonly failed: boolean;
}

interface OwnerUidSourceResult {
  readonly value: readonly string[];
  readonly failed: boolean;
}

interface PersonalizedMediaResult {
  readonly connectionOwnerUids: readonly string[];
  readonly compatibleOwnerUids: readonly string[];
  readonly connectionsFailed: boolean;
  readonly compatibilityFailed: boolean;
  readonly photos: FeedSourceResult<readonly IPublicPhotoItem[]>;
  readonly videos: FeedSourceResult<readonly IPublicVideoItem[]>;
}

interface MediaContextResult {
  readonly photosResult: FeedSourceResult<readonly IPublicPhotoItem[]>;
  readonly videosResult: FeedSourceResult<readonly IPublicVideoItem[]>;
  readonly personalizedMedia: PersonalizedMediaResult;
  readonly recentViews: FeedSourceResult<readonly string[]>;
}

const PHOTO_LIMIT = 12;
const VIDEO_LIMIT = 12;
const CONNECTION_OWNER_LIMIT = 24;
const COMPATIBLE_OWNER_LIMIT = 6;
const PERSONALIZED_OWNER_LIMIT = 30;
const PERSONALIZED_PHOTO_LIMIT = 12;
const PERSONALIZED_VIDEO_LIMIT = 12;
const SPACE_LIMIT = 4;
const SOCIAL_SPACES_ENABLED = isFeatureEnabled('communityPreview');

const EMPTY_PHOTO_RESULT: FeedSourceResult<readonly IPublicPhotoItem[]> =
  Object.freeze({ value: [], failed: false });
const EMPTY_VIDEO_RESULT: FeedSourceResult<readonly IPublicVideoItem[]> =
  Object.freeze({ value: [], failed: false });
const EMPTY_OWNER_UID_SOURCE: OwnerUidSourceResult = Object.freeze({
  value: [],
  failed: false,
});
const EMPTY_RECENT_VIEW_RESULT: FeedSourceResult<readonly string[]> =
  Object.freeze({ value: [], failed: false });
const EMPTY_PERSONALIZED_MEDIA: PersonalizedMediaResult = Object.freeze({
  connectionOwnerUids: [],
  compatibleOwnerUids: [],
  connectionsFailed: false,
  compatibilityFailed: false,
  photos: EMPTY_PHOTO_RESULT,
  videos: EMPTY_VIDEO_RESULT,
});

@Injectable({ providedIn: 'root' })
export class PrincipalFeedService {
  private readonly mediaQuery = inject(MediaPublicQueryService);
  private readonly recentViews = inject(PublicMediaRecentViewService);
  private readonly videoRanking = inject(PublicVideoRankingQueryService);
  private readonly communityRepository = inject(CommunityPreviewRepository);
  private readonly authSession = inject(AuthSessionService);
  private readonly friendship = inject(FriendshipService);
  private readonly compatibleCandidates = inject(CompatibleProfileCandidatesService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly refreshSubject = new BehaviorSubject<void>(undefined);

  readonly state$: Observable<PrincipalFeedState> = combineLatest([
    this.refreshSubject,
    this.authSession.uid$,
  ]).pipe(
    switchMap(([, viewerUid]) => {
      const mediaContext$ = combineLatest([
        this.loadPhotos$(),
        this.loadVideos$(),
        this.loadPersonalizedMedia$(viewerUid),
      ]).pipe(
        switchMap(([
          photosResult,
          videosResult,
          personalizedMedia,
        ]) => this.loadRecentViewContext$(
          viewerUid,
          photosResult,
          videosResult,
          personalizedMedia
        ))
      );

      return combineLatest([
        mediaContext$,
        this.loadSpaces$('community'),
        this.loadSpaces$('venue'),
      ]).pipe(
        map(([
          mediaContext,
          communitiesResult,
          venuesResult,
        ]) => this.buildState(
          mediaContext,
          communitiesResult,
          venuesResult
        ))
      );
    }),
    startWith(PRINCIPAL_FEED_LOADING_STATE),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  refresh(): void {
    this.refreshSubject.next();
  }

  private buildState(
    mediaContext: MediaContextResult,
    communitiesResult: FeedSourceResult<readonly CommunityPreviewCard[]>,
    venuesResult: FeedSourceResult<readonly CommunityPreviewCard[]>
  ): PrincipalFeedState {
    const {
      photosResult,
      videosResult,
      personalizedMedia,
      recentViews,
    } = mediaContext;
    const failedSources: PrincipalFeedSource[] = [];

    if (photosResult.failed) failedSources.push('photos');
    if (videosResult.failed) failedSources.push('videos');
    if (personalizedMedia.connectionsFailed) failedSources.push('connections');
    if (personalizedMedia.compatibilityFailed) failedSources.push('compatibility');
    if (personalizedMedia.photos.failed) failedSources.push('personalizedPhotos');
    if (personalizedMedia.videos.failed) failedSources.push('personalizedVideos');
    if (recentViews.failed) failedSources.push('recentViews');
    if (communitiesResult.failed) failedSources.push('communities');
    if (venuesResult.failed) failedSources.push('venues');

    const allPhotos = [
      ...photosResult.value,
      ...personalizedMedia.photos.value,
    ];
    const allVideos = [
      ...videosResult.value,
      ...personalizedMedia.videos.value,
    ];
    const items = buildPrincipalFeedItems(
      allPhotos,
      allVideos,
      communitiesResult.value,
      venuesResult.value,
      24,
      personalizedMedia.connectionOwnerUids,
      personalizedMedia.compatibleOwnerUids,
      recentViews.value
    );
    const visiblePhotos = this.collectVisiblePhotos(items);
    const visibleVideos = this.collectVisibleVideos(items);
    const allCoreSourcesFailed =
      photosResult.failed &&
      videosResult.failed &&
      (
        !SOCIAL_SPACES_ENABLED ||
        (communitiesResult.failed && venuesResult.failed)
      );

    return {
      status: items.length > 0
        ? 'ready'
        : allCoreSourcesFailed
          ? 'error'
          : 'empty',
      items,
      photos: visiblePhotos,
      videos: visibleVideos,
      failedSources,
      continuationContext: {
        connectionOwnerUids: personalizedMedia.connectionOwnerUids,
        compatibleOwnerUids: personalizedMedia.compatibleOwnerUids,
      },
    };
  }

  private loadRecentViewContext$(
    viewerUid: string | null,
    photosResult: FeedSourceResult<readonly IPublicPhotoItem[]>,
    videosResult: FeedSourceResult<readonly IPublicVideoItem[]>,
    personalizedMedia: PersonalizedMediaResult
  ): Observable<MediaContextResult> {
    const safeViewerUid = String(viewerUid ?? '').trim();
    const allPhotos = [
      ...photosResult.value,
      ...personalizedMedia.photos.value,
    ];
    const allVideos = [
      ...videosResult.value,
      ...personalizedMedia.videos.value,
    ];
    const candidates = this.buildRecentViewCandidates(
      safeViewerUid,
      allPhotos,
      allVideos
    );

    if (!safeViewerUid || !candidates.length) {
      return of({
        photosResult,
        videosResult,
        personalizedMedia,
        recentViews: EMPTY_RECENT_VIEW_RESULT,
      });
    }

    return this.recentViews.resolveRecentViewedKeys$(
      candidates,
      { propagateErrors: true }
    ).pipe(
      map((value) => ({
        photosResult,
        videosResult,
        personalizedMedia,
        recentViews: { value, failed: false },
      })),
      catchError(() => of({
        photosResult,
        videosResult,
        personalizedMedia,
        recentViews: { value: [], failed: true },
      }))
    );
  }

  private buildRecentViewCandidates(
    viewerUid: string,
    photos: readonly IPublicPhotoItem[],
    videos: readonly IPublicVideoItem[]
  ): IPublicMediaRecentViewCandidate[] {
    const candidates: IPublicMediaRecentViewCandidate[] = [];

    for (const photo of photos ?? []) {
      const ownerUid = String(photo?.ownerUid ?? '').trim();
      const mediaId = String(photo?.id ?? '').trim();

      if (!ownerUid || !mediaId || ownerUid === viewerUid) continue;
      candidates.push({ mediaType: 'PHOTO', ownerUid, mediaId });
    }

    for (const video of videos ?? []) {
      const ownerUid = String(video?.ownerUid ?? '').trim();
      const mediaId = String(video?.id ?? '').trim();

      if (!ownerUid || !mediaId || ownerUid === viewerUid) continue;
      candidates.push({ mediaType: 'VIDEO', ownerUid, mediaId });
    }

    return candidates;
  }

  private loadPhotos$(): Observable<
    FeedSourceResult<readonly IPublicPhotoItem[]>
  > {
    return this.mediaQuery.getLatestPublicPhotos$(PHOTO_LIMIT).pipe(
      map((value) => ({ value: value ?? [], failed: false })),
      catchError((error: unknown) => {
        this.reportSourceError('photos', error);
        return of({ value: [], failed: true });
      })
    );
  }

  private loadVideos$(): Observable<
    FeedSourceResult<readonly IPublicVideoItem[]>
  > {
    return this.videoRanking.loadPage$({
      mode: 'latest',
      pageSize: VIDEO_LIMIT,
      cursor: null,
      propagateErrors: true,
      notifyOnError: false,
    }).pipe(
      map((page) => ({ value: [...(page.items ?? [])], failed: false })),
      catchError((error: unknown) => {
        this.reportSourceError('videos', error);
        return of({ value: [], failed: true });
      })
    );
  }

  private loadPersonalizedMedia$(
    viewerUid: string | null
  ): Observable<PersonalizedMediaResult> {
    const safeViewerUid = String(viewerUid ?? '').trim();

    if (!safeViewerUid) {
      return of(EMPTY_PERSONALIZED_MEDIA);
    }

    return combineLatest([
      this.loadConnectionOwnerUids$(safeViewerUid),
      this.loadCompatibleOwnerUids$(),
    ]).pipe(
      switchMap(([connections, compatibility]) => {
        const connectionOwnerUids = [...connections.value];
        const connectionSet = new Set(connectionOwnerUids);
        const compatibleOwnerUids = compatibility.value
          .filter((uid) => !connectionSet.has(uid))
          .slice(0, COMPATIBLE_OWNER_LIMIT);
        const ownerUids = [
          ...connectionOwnerUids,
          ...compatibleOwnerUids,
        ].slice(0, PERSONALIZED_OWNER_LIMIT);

        if (!ownerUids.length) {
          return of({
            ...EMPTY_PERSONALIZED_MEDIA,
            connectionOwnerUids,
            compatibleOwnerUids,
            connectionsFailed: connections.failed,
            compatibilityFailed: compatibility.failed,
          });
        }

        return combineLatest([
          this.loadPersonalizedPhotos$(ownerUids),
          this.loadPersonalizedVideos$(ownerUids),
        ]).pipe(
          map(([photos, videos]) => ({
            connectionOwnerUids,
            compatibleOwnerUids,
            connectionsFailed: connections.failed,
            compatibilityFailed: compatibility.failed,
            photos,
            videos,
          }))
        );
      })
    );
  }

  private loadConnectionOwnerUids$(
    viewerUid: string
  ): Observable<OwnerUidSourceResult> {
    return this.friendship.watchFriends(viewerUid).pipe(
      map((friends) => this.normalizeOwnerUids(
        (friends ?? []).map((friend) => friend?.friendUid),
        CONNECTION_OWNER_LIMIT
      )),
      distinctUntilChanged((previous, current) =>
        this.sameStringArray(previous, current)
      ),
      map((value) => ({ value, failed: false })),
      catchError((error: unknown) => {
        this.reportSourceError('connections', error);
        return of({ ...EMPTY_OWNER_UID_SOURCE, failed: true });
      })
    );
  }

  private loadCompatibleOwnerUids$(): Observable<OwnerUidSourceResult> {
    return this.compatibleCandidates.ownerUids$.pipe(
      map((ownerUids) => this.normalizeOwnerUids(
        ownerUids,
        COMPATIBLE_OWNER_LIMIT
      )),
      distinctUntilChanged((previous, current) =>
        this.sameStringArray(previous, current)
      ),
      map((value) => ({ value, failed: false })),
      catchError((error: unknown) => {
        this.reportSourceError('compatibility', error);
        return of({ ...EMPTY_OWNER_UID_SOURCE, failed: true });
      })
    );
  }

  private loadPersonalizedPhotos$(
    ownerUids: readonly string[]
  ): Observable<FeedSourceResult<readonly IPublicPhotoItem[]>> {
    return this.mediaQuery.getRecentPublicPhotosByOwners$(
      ownerUids,
      PERSONALIZED_PHOTO_LIMIT,
      { propagateErrors: true }
    ).pipe(
      map((value) => ({ value: value ?? [], failed: false })),
      catchError((error: unknown) => {
        this.reportSourceError('personalizedPhotos', error);
        return of({ value: [], failed: true });
      })
    );
  }

  private loadPersonalizedVideos$(
    ownerUids: readonly string[]
  ): Observable<FeedSourceResult<readonly IPublicVideoItem[]>> {
    return this.mediaQuery.getRecentPublicVideoPreviewsByOwners$(
      ownerUids,
      PERSONALIZED_VIDEO_LIMIT,
      { propagateErrors: true }
    ).pipe(
      map((value) => ({ value: value ?? [], failed: false })),
      catchError((error: unknown) => {
        this.reportSourceError('personalizedVideos', error);
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

  private normalizeOwnerUids(
    values: readonly (string | null | undefined)[],
    limit: number
  ): string[] {
    const unique = new Set<string>();

    for (const value of values ?? []) {
      const uid = String(value ?? '').trim();
      if (!uid) continue;

      unique.add(uid);
      if (unique.size >= limit) break;
    }

    return [...unique].sort((left, right) => left.localeCompare(right));
  }

  private sameStringArray(
    left: readonly string[],
    right: readonly string[]
  ): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }

  private collectVisiblePhotos(
    items: readonly PrincipalFeedItem[]
  ): IPublicPhotoItem[] {
    return items.flatMap((item) =>
      item.kind === 'profile-photo' ? [item.photo] : []
    );
  }

  private collectVisibleVideos(
    items: readonly PrincipalFeedItem[]
  ): IPublicVideoItem[] {
    return items.flatMap((item) =>
      item.kind === 'profile-video' ? [item.video] : []
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
