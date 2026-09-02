// src/app/community/discovery/community-discovery-visibility.directive.ts
import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  DestroyRef,
  Directive,
  ElementRef,
  PLATFORM_ID,
  inject,
  input,
  output,
} from '@angular/core';

export const COMMUNITY_DISCOVERY_VISIBLE_RATIO = 0.6;
export const COMMUNITY_DISCOVERY_VISIBLE_DWELL_MS = 1_000;

@Directive({
  selector: '[appCommunityDiscoveryVisibility]',
  standalone: true,
})
export class CommunityDiscoveryVisibilityDirective implements AfterViewInit {
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private observer: IntersectionObserver | null = null;
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;
  private emitted = false;

  readonly communityId = input.required<string>({
    alias: 'appCommunityDiscoveryVisibility',
  });
  readonly qualifiedExposure = output<string>();

  constructor() {
    this.destroyRef.onDestroy(() => this.dispose());
  }

  ngAfterViewInit(): void {
    if (
      !isPlatformBrowser(this.platformId)
      || typeof IntersectionObserver !== 'function'
    ) {
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => this.handleEntries(entries),
      {
        threshold: [0, COMMUNITY_DISCOVERY_VISIBLE_RATIO, 1],
      }
    );
    this.observer.observe(this.element.nativeElement);
  }

  private handleEntries(entries: readonly IntersectionObserverEntry[]): void {
    if (this.emitted) return;

    const entry = entries.find(
      (candidate) => candidate.target === this.element.nativeElement
    );
    const visible = Boolean(
      entry?.isIntersecting
      && entry.intersectionRatio >= COMMUNITY_DISCOVERY_VISIBLE_RATIO
    );

    if (!visible) {
      this.clearDwellTimer();
      return;
    }

    if (this.dwellTimer !== null) return;

    this.dwellTimer = setTimeout(() => {
      this.dwellTimer = null;
      const communityId = String(this.communityId() ?? '').trim();
      if (!communityId || this.emitted) return;

      this.emitted = true;
      this.qualifiedExposure.emit(communityId);
      this.observer?.disconnect();
      this.observer = null;
    }, COMMUNITY_DISCOVERY_VISIBLE_DWELL_MS);
  }

  private clearDwellTimer(): void {
    if (this.dwellTimer === null) return;
    clearTimeout(this.dwellTimer);
    this.dwellTimer = null;
  }

  private dispose(): void {
    this.clearDwellTimer();
    this.observer?.disconnect();
    this.observer = null;
  }
}
