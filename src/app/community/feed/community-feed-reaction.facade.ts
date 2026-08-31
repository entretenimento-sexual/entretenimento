// src/app/community/feed/community-feed-reaction.facade.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED REACTION FACADE
// -----------------------------------------------------------------------------
// Estado otimista, serialização, rollback e reconciliação realtime das reações.
// Deve ser provida por instância do Mural para que overrides temporários nunca
// vazem entre Comunidades ou instâncias simultâneas do componente.
// -----------------------------------------------------------------------------

import { Injectable, inject, signal } from '@angular/core';
import {
  Subject,
  catchError,
  concatMap,
  finalize,
  map,
  of,
  shareReplay,
  startWith,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityFeedItem,
  CommunityFeedReactionRequest,
  CommunityFeedView,
} from '../data-access/community-feed.model';
import type { CommunityFeedRealtimeChange } from '../data-access/community-feed-realtime.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityPreviewSourceType } from '../data-access/community-preview.model';
import {
  COMMUNITY_FEED_REACTION_CODE_MESSAGES,
  COMMUNITY_FEED_REACTION_REASON_MESSAGES,
} from '../presentation/community-error.messages';

export interface CommunityFeedReactionContext {
  readonly communityId: string;
  readonly view: CommunityFeedView;
  readonly sourceType: CommunityPreviewSourceType;
}

export type CommunityFeedReactionState =
  | { status: 'idle'; postId: null }
  | { status: 'loading' | 'error'; postId: string };

interface CommunityFeedReactionOverride {
  reacted: boolean;
  reactionCount: number;
}

interface CommunityFeedReactionCommand {
  readonly request: CommunityFeedReactionRequest;
  readonly previous: CommunityFeedReactionOverride;
  readonly context: CommunityFeedReactionContext;
}

@Injectable()
export class CommunityFeedReactionFacade {
  private readonly repository = inject(CommunityFeedRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly reactionRequests$ = new Subject<CommunityFeedReactionCommand>();
  private readonly pendingReactionKeys = new Set<string>();
  private readonly reactionOverrides = signal<
    ReadonlyMap<string, CommunityFeedReactionOverride>
  >(new Map());

  readonly reactionState$ = this.reactionRequests$.pipe(
    concatMap((command) => {
      const key = this.reactionKey(
        command.context.communityId,
        command.request.postId
      );

      return this.repository.toggleReaction$(command.request).pipe(
        tap((result) => {
          this.setReactionOverride(
            result.communityId,
            result.postId,
            {
              reacted: result.reacted,
              reactionCount: result.reactionCount,
            }
          );
        }),
        map((): CommunityFeedReactionState => ({ status: 'idle', postId: null })),
        startWith<CommunityFeedReactionState>({
          status: 'loading',
          postId: command.request.postId,
        }),
        catchError((error: unknown) => {
          this.setReactionOverride(
            command.context.communityId,
            command.request.postId,
            command.previous
          );
          this.reportReactionError(error, command.context);
          return of<CommunityFeedReactionState>({
            status: 'error',
            postId: command.request.postId,
          });
        }),
        finalize(() => this.pendingReactionKeys.delete(key))
      );
    }),
    startWith<CommunityFeedReactionState>({ status: 'idle', postId: null }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  toggleReaction(
    item: CommunityFeedItem,
    context: CommunityFeedReactionContext
  ): void {
    const communityId = context.communityId.trim();
    const key = this.reactionKey(communityId, item.postId);
    if (!item.capabilities.canReact || this.pendingReactionKeys.has(key)) {
      return;
    }

    const previous: CommunityFeedReactionOverride = {
      reacted: this.viewerReacted(item, communityId),
      reactionCount: this.reactionCount(item, communityId),
    };
    const optimistic: CommunityFeedReactionOverride = {
      reacted: !previous.reacted,
      reactionCount: previous.reacted
        ? Math.max(0, previous.reactionCount - 1)
        : Math.min(1_000_000_000, previous.reactionCount + 1),
    };

    this.pendingReactionKeys.add(key);
    this.setReactionOverride(communityId, item.postId, optimistic);
    this.reactionRequests$.next({
      request: {
        communityId,
        postId: item.postId,
        reacted: optimistic.reacted,
      },
      previous,
      context: {
        ...context,
        communityId,
      },
    });
  }

  reactionCount(item: CommunityFeedItem, communityId: string): number {
    return this.reactionOverrides().get(
      this.reactionKey(communityId, item.postId)
    )?.reactionCount ?? item.metrics.reactionCount;
  }

  viewerReacted(item: CommunityFeedItem, communityId: string): boolean {
    return this.reactionOverrides().get(
      this.reactionKey(communityId, item.postId)
    )?.reacted ?? item.capabilities.viewerReacted;
  }

  reconcileRealtime(
    changes: readonly CommunityFeedRealtimeChange[],
    communityId: string
  ): void {
    const safeCommunityId = communityId.trim();
    let next: Map<string, CommunityFeedReactionOverride> | null = null;

    for (const change of changes) {
      const postId = change.projection.postId;
      const key = this.reactionKey(safeCommunityId, postId);
      const removed = change.type === 'removed'
        || change.projection.state === 'removed';

      if (removed) {
        if (this.reactionOverrides().has(key)) {
          next ??= new Map(this.reactionOverrides());
          next.delete(key);
        }
        continue;
      }

      const current = this.reactionOverrides().get(key);
      if (!current) continue;

      next ??= new Map(this.reactionOverrides());
      next.set(key, {
        reacted: current.reacted,
        reactionCount: change.projection.metrics.reactionCount,
      });
    }

    if (next) this.reactionOverrides.set(next);
  }

  clearItem(postId: string, communityId: string): void {
    const key = this.reactionKey(communityId, postId);
    if (!this.reactionOverrides().has(key)) return;

    const next = new Map(this.reactionOverrides());
    next.delete(key);
    this.reactionOverrides.set(next);
  }

  private setReactionOverride(
    communityId: string,
    postId: string,
    override: CommunityFeedReactionOverride
  ): void {
    const next = new Map(this.reactionOverrides());
    next.set(this.reactionKey(communityId, postId), override);
    this.reactionOverrides.set(next);
  }

  private reactionKey(communityId: string, postId: string): string {
    return `${communityId.trim()}:${postId}`;
  }

  private reportReactionError(
    error: unknown,
    context: CommunityFeedReactionContext
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'toggleReaction',
      fallbackMessage: 'Não foi possível atualizar sua reação agora.',
      reasonMessages: COMMUNITY_FEED_REACTION_REASON_MESSAGES,
      codeMessages: COMMUNITY_FEED_REACTION_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityFeedReactionFacade',
        view: context.view,
        sourceType: context.sourceType,
        communityId: context.communityId || null,
      },
    });
  }
}
