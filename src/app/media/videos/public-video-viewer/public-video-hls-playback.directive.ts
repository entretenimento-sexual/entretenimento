import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Directive,
  ElementRef,
  HostListener,
  OnDestroy,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import {
  PublicVideoHlsPlaybackCoordinatorService,
  type PublicVideoHlsPlaybackConnection,
} from 'src/app/core/services/media/public-video-hls-playback-coordinator.service';

interface PublicVideoViewerHlsData {
  readonly items?: readonly IPublicVideoItem[];
  readonly startIndex?: number;
}

@Directive({
  selector: '[appPublicVideoHlsPlayback]',
  standalone: true,
})
export class PublicVideoHlsPlaybackDirective
  implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLVideoElement>);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly coordinator = inject(
    PublicVideoHlsPlaybackCoordinatorService
  );
  private readonly viewerData = inject<PublicVideoViewerHlsData | null>(
    MAT_DIALOG_DATA,
    { optional: true }
  );

  private connection: PublicVideoHlsPlaybackConnection | null = null;
  private currentItemIndex = -1;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.currentItemIndex = this.resolveCurrentItemIndex();
    this.connection = this.coordinator.connect(
      this.elementRef.nativeElement,
      () => this.resolveCurrentItem()
    );
  }

  ngOnDestroy(): void {
    this.connection?.destroy();
    this.connection = null;
  }

  @HostListener('window:online')
  onWindowOnline(): void {
    this.connection?.refresh();
  }

  private resolveCurrentItem(): IPublicVideoItem | null {
    const nextIndex = this.resolveCurrentItemIndex();

    if (nextIndex >= 0) {
      this.currentItemIndex = nextIndex;
    }

    return (this.viewerData?.items ?? [])[this.currentItemIndex] ?? null;
  }

  private resolveCurrentItemIndex(): number {
    const items = this.viewerData?.items ?? [];
    const video = this.elementRef.nativeElement;
    const declaredSource = video.getAttribute('src') || video.src;
    const currentIdentity = this.assetIdentity(declaredSource);

    if (currentIdentity && currentIdentity !== 'blob:') {
      const matchedIndex = items.findIndex(
        (item) => this.assetIdentity(item.url) === currentIdentity
      );

      if (matchedIndex >= 0) {
        return matchedIndex;
      }
    }

    if (
      this.currentItemIndex >= 0 &&
      this.currentItemIndex < items.length
    ) {
      return this.currentItemIndex;
    }

    if (!items.length) {
      return -1;
    }

    const startIndex = Number(this.viewerData?.startIndex ?? 0);
    const normalizedStart = Number.isFinite(startIndex)
      ? Math.trunc(startIndex)
      : 0;
    return Math.max(0, Math.min(normalizedStart, items.length - 1));
  }

  private assetIdentity(value: string): string {
    const normalized = String(value ?? '').trim();

    if (!normalized) {
      return '';
    }

    if (normalized.toLowerCase().startsWith('blob:')) {
      return 'blob:';
    }

    try {
      const parsed = new URL(normalized, this.document.baseURI);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return normalized.split('?')[0]?.split('#')[0] ?? normalized;
    }
  }
}
