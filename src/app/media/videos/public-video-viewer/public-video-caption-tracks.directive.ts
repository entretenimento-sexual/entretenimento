import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  DestroyRef,
  Directive,
  ElementRef,
  HostListener,
  OnDestroy,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { take } from 'rxjs/operators';

import type {
  IPublicVideoCaptionTrack,
  IPublicVideoItem,
} from 'src/app/core/interfaces/media/i-public-video-item';
import { PublicVideoAccessService } from 'src/app/core/services/media/public-video-access.service';

interface PublicVideoCaptionViewerData {
  readonly items?: readonly IPublicVideoItem[];
  readonly startIndex?: number;
}

const PLATFORM_TRACK_ATTRIBUTE = 'data-platform-caption';
const MAX_CAPTION_TRACKS = 4;

@Directive({
  selector: '[appPublicVideoCaptionTracks]',
  standalone: true,
})
export class PublicVideoCaptionTracksDirective
  implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLVideoElement>);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly publicVideoAccess = inject(PublicVideoAccessService, {
    optional: true,
  });
  private readonly viewerData = inject<PublicVideoCaptionViewerData | null>(
    MAT_DIALOG_DATA,
    { optional: true }
  );

  private readonly renewedItems = new Map<string, IPublicVideoItem>();
  private readonly refreshingKeys = new Set<string>();
  private sourceObserver: MutationObserver | null = null;
  private currentItemIndex = -1;
  private destroyed = false;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.currentItemIndex = this.resolveCurrentItemIndex();
    this.syncTracks();
    this.sourceObserver = new MutationObserver(() => this.syncTracks());
    this.sourceObserver.observe(this.elementRef.nativeElement, {
      attributes: true,
      attributeFilter: ['src'],
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.sourceObserver?.disconnect();
    this.sourceObserver = null;
    this.removePlatformTracks();
    this.renewedItems.clear();
    this.refreshingKeys.clear();
  }

  @HostListener('loadstart')
  onLoadStart(): void {
    this.syncTracks();
  }

  private syncTracks(): void {
    if (this.destroyed) {
      return;
    }

    const item = this.resolveCurrentItem();
    this.removePlatformTracks();

    if (!item?.captionTracks?.length) {
      return;
    }

    for (const track of item.captionTracks.slice(0, MAX_CAPTION_TRACKS)) {
      if (!this.isValidTrack(track)) {
        continue;
      }

      const trackElement = this.document.createElement('track');
      trackElement.setAttribute(PLATFORM_TRACK_ATTRIBUTE, 'true');
      trackElement.kind = 'captions';
      trackElement.src = track.url;
      trackElement.srclang = track.language;
      trackElement.label = track.label;
      trackElement.default = track.isDefault;
      trackElement.addEventListener(
        'error',
        () => this.refreshTracks(item),
        { once: true }
      );
      this.elementRef.nativeElement.appendChild(trackElement);
    }
  }

  private refreshTracks(item: IPublicVideoItem): void {
    const key = this.itemKey(item);

    if (
      !key ||
      this.refreshingKeys.has(key) ||
      !this.publicVideoAccess
    ) {
      return;
    }

    this.refreshingKeys.add(key);
    this.publicVideoAccess.refreshPublicVideoUrl$(item).pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (renewed) => {
        this.refreshingKeys.delete(key);

        if (!renewed || this.destroyed) {
          return;
        }

        this.renewedItems.set(key, renewed);
        this.syncTracks();
      },
      error: () => {
        this.refreshingKeys.delete(key);
      },
    });
  }

  private resolveCurrentItem(): IPublicVideoItem | null {
    const nextIndex = this.resolveCurrentItemIndex();

    if (nextIndex >= 0) {
      this.currentItemIndex = nextIndex;
    }

    const item = (this.viewerData?.items ?? [])[this.currentItemIndex] ?? null;

    if (!item) {
      return null;
    }

    return this.renewedItems.get(this.itemKey(item)) ?? item;
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

  private removePlatformTracks(): void {
    this.elementRef.nativeElement
      .querySelectorAll(`track[${PLATFORM_TRACK_ATTRIBUTE}]`)
      .forEach((track) => track.remove());
  }

  private isValidTrack(track: IPublicVideoCaptionTrack): boolean {
    return !!track?.id?.trim() &&
      track.kind === 'captions' &&
      /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(track.language) &&
      !!track.label?.trim() &&
      this.isTemporaryUrl(track.url);
  }

  private itemKey(item: IPublicVideoItem): string {
    const ownerUid = String(item?.ownerUid ?? '').trim();
    const videoId = String(item?.id ?? '').trim();
    return ownerUid && videoId ? `${ownerUid}:${videoId}` : '';
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

  private isTemporaryUrl(value: string): boolean {
    try {
      const url = new URL(String(value ?? '').trim(), this.document.baseURI);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }
}
