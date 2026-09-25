import { ElementRef, Injectable, signal } from '@angular/core';

import {
  buildCommunityBoundedRenderWindow,
  communityTailRenderWindowStart,
  normalizeCommunityRenderWindowStart,
} from '../community-bounded-render-window.util';
import {
  DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
} from '../data-access/community-discovery.contract';

const COMMUNITY_DISCOVERY_RENDER_WINDOW_PAGES = 6;
const COMMUNITY_DISCOVERY_RENDER_WINDOW_MAX_ITEMS =
  DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE * COMMUNITY_DISCOVERY_RENDER_WINDOW_PAGES;

interface CommunityDiscoveryWindowItem {
  readonly communityId: string;
}

type CommunityDiscoveryElementResolver =
  () => readonly ElementRef<HTMLElement>[];

@Injectable()
export class CommunityDiscoveryRenderWindowFacade {
  private readonly renderWindowStart = signal(0);
  private lastItemIds: readonly string[] = [];
  private lastMineWindowKey = '';
  private followTailAfterAppend = false;
  private pendingScrollAnchor: {
    readonly communityId: string;
    readonly top: number;
  } | null = null;

  window<T>(items: readonly T[]) {
    return buildCommunityBoundedRenderWindow(
      items,
      COMMUNITY_DISCOVERY_RENDER_WINDOW_MAX_ITEMS,
      this.renderWindowStart()
    );
  }

  markAppendLoaded(): void {
    this.followTailAfterAppend = true;
  }

  prepareLoadMore(resolveElements: CommunityDiscoveryElementResolver): void {
    this.captureScrollAnchor(resolveElements);
  }

  reconcile(
    items: readonly CommunityDiscoveryWindowItem[],
    options: {
      readonly mineMode: boolean;
      readonly mineWindowKey: string;
      readonly loadingMore: boolean;
      readonly resolveElements: CommunityDiscoveryElementResolver;
    }
  ): void {
    const mineWindowChanged =
      options.mineMode
      && options.mineWindowKey !== this.lastMineWindowKey;
    const previousFirstId = mineWindowChanged
      ? null
      : this.lastItemIds[this.renderWindowStart()] ?? null;
    let nextStart = this.renderWindowStart();

    if (mineWindowChanged) {
      nextStart = 0;
    } else if (this.followTailAfterAppend) {
      nextStart = communityTailRenderWindowStart(
        items.length,
        COMMUNITY_DISCOVERY_RENDER_WINDOW_MAX_ITEMS
      );
      this.followTailAfterAppend = false;
    } else if (previousFirstId) {
      const anchoredIndex = items.findIndex(
        (item) => item.communityId === previousFirstId
      );
      nextStart = anchoredIndex >= 0
        ? normalizeCommunityRenderWindowStart(
            items.length,
            COMMUNITY_DISCOVERY_RENDER_WINDOW_MAX_ITEMS,
            anchoredIndex
          )
        : normalizeCommunityRenderWindowStart(
            items.length,
            COMMUNITY_DISCOVERY_RENDER_WINDOW_MAX_ITEMS,
            nextStart
          );
    } else {
      nextStart = normalizeCommunityRenderWindowStart(
        items.length,
        COMMUNITY_DISCOVERY_RENDER_WINDOW_MAX_ITEMS,
        nextStart
      );
    }

    this.lastItemIds = items.map((item) => item.communityId);
    this.lastMineWindowKey = options.mineWindowKey;

    if (nextStart !== this.renderWindowStart()) {
      this.renderWindowStart.set(nextStart);
    }

    if (!options.loadingMore && this.pendingScrollAnchor) {
      this.restoreScrollAnchor(options.resolveElements);
    }
  }

  showPreviousLoaded(
    items: readonly CommunityDiscoveryWindowItem[],
    resolveElements: CommunityDiscoveryElementResolver
  ): void {
    this.shift(
      items,
      -DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
      resolveElements
    );
  }

  showNextLoaded(
    items: readonly CommunityDiscoveryWindowItem[],
    resolveElements: CommunityDiscoveryElementResolver
  ): void {
    this.shift(
      items,
      DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
      resolveElements
    );
  }

  reset(): void {
    this.followTailAfterAppend = false;
    this.pendingScrollAnchor = null;
    this.lastItemIds = [];
    this.lastMineWindowKey = '';
    this.renderWindowStart.set(0);
  }

  private shift(
    items: readonly CommunityDiscoveryWindowItem[],
    delta: number,
    resolveElements: CommunityDiscoveryElementResolver
  ): void {
    if (items.length <= COMMUNITY_DISCOVERY_RENDER_WINDOW_MAX_ITEMS) return;

    this.captureScrollAnchor(resolveElements);
    this.followTailAfterAppend = false;
    this.renderWindowStart.set(
      normalizeCommunityRenderWindowStart(
        items.length,
        COMMUNITY_DISCOVERY_RENDER_WINDOW_MAX_ITEMS,
        this.renderWindowStart() + delta
      )
    );
    this.restoreScrollAnchor(resolveElements);
  }

  private captureScrollAnchor(
    resolveElements: CommunityDiscoveryElementResolver
  ): void {
    const elements = resolveElements();
    const candidate =
      elements[Math.floor(elements.length / 2)]?.nativeElement ?? null;
    const communityId = candidate?.dataset['communityId']?.trim() ?? '';

    this.pendingScrollAnchor = candidate && communityId
      ? {
          communityId,
          top: candidate.getBoundingClientRect().top,
        }
      : null;
  }

  private restoreScrollAnchor(
    resolveElements: CommunityDiscoveryElementResolver
  ): void {
    const anchor = this.pendingScrollAnchor;
    this.pendingScrollAnchor = null;
    if (!anchor) return;

    queueMicrotask(() => {
      const restore = () => {
        const target = resolveElements().find(
          (element) =>
            element.nativeElement.dataset['communityId'] === anchor.communityId
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
      };

      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(restore);
      } else {
        restore();
      }
    });
  }
}
