// src/app/community/data-access/community-feed.repository.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED REPOSITORY
// -----------------------------------------------------------------------------
// A página e a hidratação completa continuam autorizadas por callable. O
// Firestore expõe apenas um stream realtime mínimo, sem conteúdo ou dados
// sensíveis, usado para sinalizar mudanças incrementais.
// -----------------------------------------------------------------------------

import {
  EnvironmentInjector,
  Injectable,
  inject,
  runInInjectionContext,
} from '@angular/core';
import {
  CollectionReference,
  DocumentData,
} from 'firebase/firestore';
import {
  Firestore,
  collection,
  collectionSnapshots,
  limit,
  orderBy,
  query,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Observable,
  defer,
  from,
  map,
  of,
  pairwise,
  tap,
} from 'rxjs';

import { CommunityDomainEventsService } from './community-domain-events.service';
import {
  CommunityFeedPage,
  CommunityFeedPageRequest,
  CommunityFeedPostCreateRequest,
  CommunityFeedPostCreateResponse,
  CommunityFeedPostActionRequest,
  CommunityFeedPostActionResponse,
  CommunityFeedReactionRequest,
  CommunityFeedReactionResponse,
  CommunityFeedView,
  normalizeCommunityFeedReactionResponse,
  normalizeCommunityFeedPostActionResponse,
  normalizeCommunityFeedPostCreateResponse,
  normalizeCommunityFeedPageResponse,
} from './community-feed.model';
import {
  CommunityFeedPostCreateWireRequest,
  buildCommunityFeedPostCreateWireRequest,
} from './community-feed-write-contract.model';
import {
  CommunityFeedRealtimeChange,
  CommunityFeedRealtimeProjection,
  diffCommunityFeedRealtimeProjections,
  normalizeCommunityFeedRealtimeProjection,
} from './community-feed-realtime.model';

interface CommunityFeedItemsHydrationRequest {
  communityId: string;
  view: CommunityFeedView;
  postIds: readonly string[];
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_REALTIME_ITEMS = 20;

@Injectable({ providedIn: 'root' })
export class CommunityFeedRepository {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly domainEvents = inject(CommunityDomainEventsService);

  private readonly getCommunityFeedPageCallable = httpsCallable<
    CommunityFeedPageRequest,
    unknown
  >(this.functions, 'getCommunityFeedPage');

  private readonly getCommunityFeedItemsCallable = httpsCallable<
    { communityId: string; view: CommunityFeedView; postIds: string[] },
    unknown
  >(this.functions, 'getCommunityFeedItems');

  private readonly createCommunityFeedPostCallable = httpsCallable<
    CommunityFeedPostCreateWireRequest,
    unknown
  >(this.functions, 'createCommunityFeedPost');

  private readonly moderateCommunityFeedPostCallable = httpsCallable<
    CommunityFeedPostActionRequest,
    unknown
  >(this.functions, 'moderateCommunityFeedPost');

  private readonly toggleCommunityFeedReactionCallable = httpsCallable<
    CommunityFeedReactionRequest,
    unknown
  >(this.functions, 'toggleCommunityFeedReaction');

  getPage$(request: CommunityFeedPageRequest): Observable<CommunityFeedPage> {
    const payload: CommunityFeedPageRequest = {
      communityId: request.communityId.trim(),
      view: request.view,
      limit: request.limit ?? 10,
      cursor: request.cursor ?? null,
    };

    return defer(() => from(this.getCommunityFeedPageCallable(payload))).pipe(
      map((result) => normalizeCommunityFeedPageResponse(result.data))
    );
  }

  getItems$(request: CommunityFeedItemsHydrationRequest): Observable<CommunityFeedPage> {
    const communityId = request.communityId.trim();
    const postIds = [...new Set(request.postIds
      .map((postId) => postId.trim())
      .filter((postId) => SAFE_ID_PATTERN.test(postId)))]
      .slice(0, MAX_REALTIME_ITEMS);

    return defer(() => from(this.getCommunityFeedItemsCallable({
      communityId,
      view: request.view,
      postIds,
    }))).pipe(
      map((result) => normalizeCommunityFeedPageResponse(result.data))
    );
  }

  watchLatestChanges$(
    communityId: string,
    pageSize = MAX_REALTIME_ITEMS
  ): Observable<readonly CommunityFeedRealtimeChange[]> {
    return defer(() => {
      const safeCommunityId = communityId.trim();
      if (!SAFE_ID_PATTERN.test(safeCommunityId)) {
        return of([] as readonly CommunityFeedRealtimeChange[]);
      }

      const safeLimit = Math.min(
        Math.max(Math.trunc(pageSize) || MAX_REALTIME_ITEMS, 1),
        MAX_REALTIME_ITEMS
      );
      const source$ = runInInjectionContext(this.environmentInjector, () => {
        const ref = collection(
          this.firestore,
          `community_feed_realtime/${safeCommunityId}/items`
        ) as CollectionReference<DocumentData>;
        return collectionSnapshots(query(
          ref,
          orderBy('eventAt', 'desc'),
          limit(safeLimit)
        ));
      });

      return source$.pipe(
        map((snapshots) => snapshots
          .map((snapshot) => normalizeCommunityFeedRealtimeProjection(
            snapshot.id,
            snapshot.data()
          ))
          .filter((item): item is CommunityFeedRealtimeProjection => item !== null)),
        // O primeiro snapshot estabelece a linha de base do stream. Transformá-lo
        // em diff contra [] faz todo item já existente parecer recém-publicado,
        // duplicando a hidratação inicial e contornando a paginação do Mural.
        pairwise(),
        map(([previous, current]) =>
          diffCommunityFeedRealtimeProjections(previous, current)
        )
      );
    });
  }

  createPost$(
    request: CommunityFeedPostCreateRequest
  ): Observable<CommunityFeedPostCreateResponse> {
    const payload = buildCommunityFeedPostCreateWireRequest(request);

    return defer(() => from(this.createCommunityFeedPostCallable(payload))).pipe(
      map((result) => normalizeCommunityFeedPostCreateResponse(result.data)),
      tap(() =>
        this.domainEvents.notifyDiscoveryChanged(
          'content_changed',
          payload.communityId
        )
      )
    );
  }

  moderatePost$(
    request: CommunityFeedPostActionRequest
  ): Observable<CommunityFeedPostActionResponse> {
    const payload: CommunityFeedPostActionRequest = {
      requestId: request.requestId.trim(),
      communityId: request.communityId.trim(),
      postId: request.postId.trim(),
      action: request.action,
      reason: request.reason?.trim() || null,
    };

    return defer(() => from(this.moderateCommunityFeedPostCallable(payload))).pipe(
      map((result) => normalizeCommunityFeedPostActionResponse(result.data)),
      tap(() =>
        this.domainEvents.notifyDiscoveryChanged(
          'content_changed',
          payload.communityId
        )
      )
    );
  }

  toggleReaction$(
    request: CommunityFeedReactionRequest
  ): Observable<CommunityFeedReactionResponse> {
    const payload: CommunityFeedReactionRequest = {
      communityId: request.communityId.trim(),
      postId: request.postId.trim(),
    };

    return defer(() => from(this.toggleCommunityFeedReactionCallable(payload))).pipe(
      map((result) => normalizeCommunityFeedReactionResponse(result.data))
    );
  }
}
