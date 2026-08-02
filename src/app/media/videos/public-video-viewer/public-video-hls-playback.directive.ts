import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Directive,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import {
  PublicVideoHlsPlaybackCoordinatorService,
  type PublicVideoHlsPlaybackConnection,
} from 'src/app/core/services/media/public-video-hls-playback-coordinator.service';
import { PublicVideoCaptionTracksDirective } from './public-video-caption-tracks.directive';

interface PublicVideoViewerHlsData {
  readonly items?: readonly IPublicVideoItem[];
  readonly startIndex?: number;
}

@Directive({
  selector: '[appPublicVideoHlsPlayback]',
  standalone: true,
  hostDirectives: [PublicVideoCaptionTracksDirective],
})
export class PublicVideoHlsPlaybackDirective
  implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLVideoElement>);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);
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

    /**
     * HLS é melhoria progressiva. Fixtures isolados, SSR ou uma configuração
     * sem AngularFire continuam usando o MP4 já presente no elemento, sem
     * instanciar serviços que dependem de Auth/Functions.
     *
     * As faixas WebVTT são uma host directive independente: continuam ativas no
     * fallback MP4 e não compartilham o lifecycle interno do runtime HLS.
     */
    const auth = this.injector.get(Auth, null);
    const functions = this.injector.get(Functions, null);

    if (!auth || !functions) {
      this.elementRef.nativeElement.dataset['playbackMode'] = 'mp4';
      return;
    }

    const coordinator = this.injector.get(
      PublicVideoHlsPlaybackCoordinatorService
    );
    this.currentItemIndex = this.resolveCurrentItemIndex();
    this.connection = coordinator.connect(
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
