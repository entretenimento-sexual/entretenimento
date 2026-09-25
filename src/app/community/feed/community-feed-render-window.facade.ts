import { ElementRef, Injectable, signal } from '@angular/core';

import {
  buildCommunityBoundedRenderWindow,
  communityRenderWindowStartForIndex,
  communityTailRenderWindowStart,
  normalizeCommunityRenderWindowStart,
} from '../community-bounded-render-window.util';
import {
  COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
  DEFAULT_COMMUNITY_FEED_PAGE_SIZE,
} from '../data-access/community-feed.model';

interface CommunityFeedWindowItem {
  readonly postId: string;
}

type CommunityFeedElementResolver =
  () => readonly ElementRef<HTMLElement>[];

@Injectable()
export class CommunityFeedRenderWindowFacade {
  private readonly renderWindowStart = signal(0);
  private lastItemIds: readonly string[] = [];
  private followTailAfterAppend = false;
  private pendingRevealPostId: string | null = null;
  private pendingScrollAnchor: {
    readonly postId: string;
    readonly top: number;
  } | null = null;

  window<T>(items: readonly T[]) {
    return buildCommunityBoundedRenderWindow(
      items,
      COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
      this.renderWindowStart()
    );
  }

  isLatestWindow(): boolean {
    return this.renderWindowStart() === 0;
  }

  markAppendLoaded(): void {
    this.followTailAfterAppend = true;
  }

  requestReveal(postId: string): void {
    const normalized = postId.trim();
    if (normalized) this.pendingRevealPostId = normalized;
  }

  prepareLoadMore(resolveElements: CommunityFeedElementResolver): void {
    this.captureScrollAnchor(resolveElements);
  }

  reconcile(
    items: readonly CommunityFeedWindowItem[],
    loadingMore: boolean,
    resolveElements: CommunityFeedElementResolver
  ): void {
    const previousFirstId =
      this.lastItemIds[this.renderWindowStart()] ?? null;
    let nextStart = this.renderWindowStart();

    if (this.pendingRevealPostId) {
      const revealIndex = items.findIndex(
        (item) => item.postId === this.pendingRevealPostId
      );
      if (revealIndex >= 0) {
        nextStart = communityRenderWindowStartForIndex(
          items.length,
          COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
          revealIndex
        );
        this.pendingRevealPostId = null;
        this.followTailAfterAppend = false;
      }
    } else if (this.followTailAfterAppend) {
      nextStart = communityTailRenderWindowStart(
        items.length,
        COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS
      );
      this.followTailAfterAppend = false;
    } else if (previousFirstId) {
      const anchoredIndex = items.findIndex(
        (item) => item.postId === previousFirstId
      );
      nextStart = anchoredIndex >= 0
        ? normalizeCommunityRenderWindowStart(
            items.length,
            COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
            anchoredIndex
          )
        : normalizeCommunityRenderWindowStart(
            items.length,
            COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
            nextStart
          );
    } else {
      nextStart = normalizeCommunityRenderWindowStart(
        items.length,
        COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
        nextStart
      );
    }

    this.lastItemIds = items.map((item) => item.postId);

    if (nextStart !== this.renderWindowStart()) {
      this.renderWindowStart.set(nextStart);
    }

    if (!loadingMore && this.pendingScrollAnchor) {
      this.restoreScrollAnchor(resolveElements);
    }
  }

  showNewerLoaded(
    items: readonly CommunityFeedWindowItem[],
    resolveElements: CommunityFeedElementResolver
  ): void {
    this.shift(items, -DEFAULT_COMMUNITY_FEED_PAGE_SIZE, resolveElements);
  }

  showOlderLoaded(
    items: readonly CommunityFeedWindowItem[],
    resolveElements: CommunityFeedElementResolver
  ): void {
    this.shift(items, DEFAULT_COMMUNITY_FEED_PAGE_SIZE, resolveElements);
  }

  revealLoadedPost(postId: string): boolean {
    if (this.isInCurrentWindow(postId)) return false;

    const index = this.lastItemIds.indexOf(postId);
    if (index < 0) return false;

    this.followTailAfterAppend = false;
    this.renderWindowStart.set(
      communityRenderWindowStartForIndex(
        this.lastItemIds.length,
        COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
        index
      )
    );
    return true;
  }

  resetToLatest(): void {
    this.followTailAfterAppend = false;
    this.pendingRevealPostId = null;
    this.pendingScrollAnchor = null;
    this.renderWindowStart.set(0);
  }

  reset(): void {
    this.followTailAfterAppend = false;
    this.pendingRevealPostId = null;
    this.pendingScrollAnchor = null;
    this.lastItemIds = [];
    this.renderWindowStart.set(0);
  }

  runAfterRender(callback: () => void): void {
    queueMicrotask(() => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(callback);
      } else {
        callback();
      }
    });
  }

  private isInCurrentWindow(postId: string): boolean {
    const index = this.lastItemIds.indexOf(postId);
    if (index < 0) return false;

    const start = this.renderWindowStart();
    return index >= start
      && index < start + COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS;
  }

  private shift(
    items: readonly CommunityFeedWindowItem[],
    delta: number,
    resolveElements: CommunityFeedElementResolver
  ): void {
    if (items.length <= COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS) return;

    this.captureScrollAnchor(resolveElements);
    this.followTailAfterAppend = false;
    this.renderWindowStart.set(
      normalizeCommunityRenderWindowStart(
        items.length,
        COMMUNITY_FEED_RENDER_WINDOW_MAX_ITEMS,
        this.renderWindowStart() + delta
      )
    );
    this.restoreScrollAnchor(resolveElements);
  }

  private captureScrollAnchor(
    resolveElements: CommunityFeedElementResolver
  ): void {
    const elements = resolveElements();
    const candidate =
      elements[Math.floor(elements.length / 2)]?.nativeElement ?? null;
    const postId = candidate?.dataset['postId']?.trim() ?? '';

    this.pendingScrollAnchor = candidate && postId
      ? {
          postId,
          top: candidate.getBoundingClientRect().top,
        }
      : null;
  }

  private restoreScrollAnchor(
    resolveElements: CommunityFeedElementResolver
  ): void {
    const anchor = this.pendingScrollAnchor;
    this.pendingScrollAnchor = null;
    if (!anchor) return;

    this.runAfterRender(() => {
      const target = resolveElements().find(
        (element) => element.nativeElement.dataset['postId'] === anchor.postId
      )?.nativeElement;
      if (
        !target
        || typeof window === 'undefined'
        || typeof window.scrollBy !== 'function'
      ) {
        return;
      }

      const delta = target.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > 0.5) {
        window.scrollBy(0, delta);
      }
    });
  }
}
