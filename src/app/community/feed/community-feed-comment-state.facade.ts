// src/app/community/feed/community-feed-comment-state.facade.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED COMMENT STATE
// -----------------------------------------------------------------------------
// Estado de apresentação dos comentários de cada card do Mural.
//
// Não lê/escreve Firestore e não assume autoridade de domínio. O componente
// continua responsável pelos bindings públicos; esta facade apenas coordena:
// - card de comentários aberto;
// - intenção explícita de responder;
// - versão do pedido de foco de resposta;
// - override local da contagem;
// - reconciliação da contagem com projeções realtime.
// -----------------------------------------------------------------------------

import { Injectable, signal } from '@angular/core';

import { CommunityFeedItem } from '../data-access/community-feed.model';
import type { CommunityFeedRealtimeChange } from '../data-access/community-feed-realtime.model';

@Injectable()
export class CommunityFeedCommentStateFacade {
  readonly commentsPostId = signal<string | null>(null);
  readonly replyPostId = signal<string | null>(null);
  readonly postReplyRequestVersion = signal(0);

  private readonly commentCountOverrides = signal<ReadonlyMap<string, number>>(
    new Map()
  );

  toggle(item: CommunityFeedItem): void {
    if (!item.capabilities.canViewComments) return;

    const isOpen = this.commentsPostId() === item.postId;
    this.commentsPostId.set(isOpen ? null : item.postId);
    // Abrir pelo contador é modo de leitura; não deve herdar intenção de resposta.
    this.replyPostId.set(null);
  }

  openForReply(item: CommunityFeedItem): void {
    if (!item.capabilities.canViewComments || !item.capabilities.canComment) {
      return;
    }

    this.commentsPostId.set(item.postId);
    this.replyPostId.set(item.postId);
    this.postReplyRequestVersion.update((current) => current + 1);
  }

  clearReplyContext(item: CommunityFeedItem): void {
    if (this.replyPostId() === item.postId) {
      this.replyPostId.set(null);
    }
  }

  commentsOpen(item: CommunityFeedItem): boolean {
    return this.commentsPostId() === item.postId;
  }

  commentCount(item: CommunityFeedItem): number {
    return this.commentCountOverrides().get(item.postId)
      ?? item.metrics.commentCount;
  }

  updateCommentCount(item: CommunityFeedItem, commentCount: number): void {
    if (!Number.isFinite(commentCount) || commentCount < 0) return;

    const next = new Map(this.commentCountOverrides());
    next.set(item.postId, Math.trunc(commentCount));
    this.commentCountOverrides.set(next);
  }

  reconcileRealtime(changes: readonly CommunityFeedRealtimeChange[]): void {
    let next: Map<string, number> | null = null;

    for (const change of changes) {
      const postId = change.projection.postId;
      if (!this.commentCountOverrides().has(postId)) continue;

      next ??= new Map(this.commentCountOverrides());

      const removed = change.type === 'removed'
        || change.projection.state === 'removed';

      if (removed) {
        next.delete(postId);
        continue;
      }

      next.set(postId, change.projection.metrics.commentCount);
    }

    if (next) this.commentCountOverrides.set(next);
  }

  clearItem(postId: string): void {
    if (this.commentCountOverrides().has(postId)) {
      const next = new Map(this.commentCountOverrides());
      next.delete(postId);
      this.commentCountOverrides.set(next);
    }

    if (this.commentsPostId() === postId) {
      this.commentsPostId.set(null);
    }

    if (this.replyPostId() === postId) {
      this.replyPostId.set(null);
    }
  }
}
