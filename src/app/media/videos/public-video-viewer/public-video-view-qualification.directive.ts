import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  DestroyRef,
  Directive,
  ElementRef,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs/operators';

import { VideoViewTrackingService } from 'src/app/core/services/media/video-view-tracking.service';

export const PUBLIC_VIDEO_VIEW_MIN_PLAYBACK_MS = 3_000;
export const PUBLIC_VIDEO_VIEW_MAX_PLAYBACK_MS = 10_000;
export const PUBLIC_VIDEO_VIEW_PLAYBACK_RATIO = 0.25;
export const PUBLIC_VIDEO_VIEW_SHORT_VIDEO_RATIO = 0.8;

export interface PublicVideoQualifiedViewDetail {
  sessionId: string;
  playbackMs: number;
  durationMs: number;
  qualifiedAt: number;
}

export function calculatePublicVideoQualifiedPlaybackMs(
  durationMs: number
): number {
  const safeDurationMs = Number.isFinite(durationMs)
    ? Math.max(0, durationMs)
    : 0;

  if (safeDurationMs <= 0) {
    return PUBLIC_VIDEO_VIEW_MIN_PLAYBACK_MS;
  }

  const standardThreshold = Math.max(
    PUBLIC_VIDEO_VIEW_MIN_PLAYBACK_MS,
    Math.min(
      PUBLIC_VIDEO_VIEW_MAX_PLAYBACK_MS,
      safeDurationMs * PUBLIC_VIDEO_VIEW_PLAYBACK_RATIO
    )
  );
  const shortVideoThreshold =
    safeDurationMs * PUBLIC_VIDEO_VIEW_SHORT_VIDEO_RATIO;

  return Math.max(
    250,
    Math.round(Math.min(standardThreshold, shortVideoThreshold))
  );
}

@Directive({
  selector: 'video.public-video-viewer__video',
  standalone: true,
})
export class PublicVideoViewQualificationDirective
  implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLVideoElement>);
  private readonly document = inject(DOCUMENT);
  private readonly ngZone = inject(NgZone);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly viewTracking = inject(VideoViewTrackingService);

  private readonly cleanupListeners: Array<() => void> = [];
  private identity = '';
  private sessionId = '';
  private preparingIdentity = '';
  private mediaPlaybackMs = 0;
  private activeWallMs = 0;
  private activeStartedAt: number | null = null;
  private lastMediaTimeMs = 0;
  private emitted = false;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      const video = this.elementRef.nativeElement;

      this.listen(video, 'playing', () => this.startActivePlayback());
      this.listen(video, 'timeupdate', () => this.onTimeUpdate());
      this.listen(video, 'pause', () => this.stopActivePlayback(true));
      this.listen(video, 'waiting', () => this.stopActivePlayback(true));
      this.listen(video, 'stalled', () => this.stopActivePlayback(true));
      this.listen(video, 'seeking', () => this.stopActivePlayback(false));
      this.listen(video, 'seeked', () => this.onSeeked());
      this.listen(video, 'ended', () => this.onEnded());
      this.listen(video, 'loadedmetadata', () => this.onLoadedMetadata());
      this.listen(this.document, 'visibilitychange', () => {
        this.onVisibilityChange();
      });
    });
  }

  ngOnDestroy(): void {
    this.stopActivePlayback(false);

    while (this.cleanupListeners.length > 0) {
      this.cleanupListeners.pop()?.();
    }
  }

  /**
   * Preserva o método existente. Quando a sessão não é fornecida, a diretiva
   * solicita ao backend uma sessão curta vinculada ao usuário e ao vídeo.
   */
  resetForVideo(identity: string, sessionId = ''): void {
    const normalizedIdentity = String(identity ?? '').trim();
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const identityChanged = normalizedIdentity !== this.identity;

    if (identityChanged) {
      this.stopActivePlayback(false);
      this.identity = normalizedIdentity;
      this.sessionId = '';
      this.preparingIdentity = '';
      this.resetPlaybackEvidence();
    }

    if (!this.identity) {
      return;
    }

    if (normalizedSessionId) {
      if (normalizedSessionId !== this.sessionId) {
        this.applySession(normalizedSessionId);
      }
      return;
    }

    if (!this.sessionId) {
      this.prepareBackendSession();
    }
  }

  private prepareBackendSession(): void {
    if (!this.identity || this.preparingIdentity === this.identity) {
      return;
    }

    const separatorIndex = this.identity.indexOf(':');
    const ownerUid = separatorIndex > 0
      ? this.identity.slice(0, separatorIndex).trim()
      : '';
    const videoId = separatorIndex > 0
      ? this.identity.slice(separatorIndex + 1).trim()
      : '';

    if (!ownerUid || !videoId || videoId.includes(':')) {
      return;
    }

    const requestedIdentity = this.identity;
    this.preparingIdentity = requestedIdentity;

    this.viewTracking.prepareVideoViewSession$(ownerUid, videoId, 'unknown')
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((session) => {
        if (this.preparingIdentity === requestedIdentity) {
          this.preparingIdentity = '';
        }

        if (
          !session ||
          this.identity !== requestedIdentity ||
          session.ownerUid !== ownerUid ||
          session.videoId !== videoId
        ) {
          return;
        }

        this.applySession(session.sessionId);
      });
  }

  private applySession(sessionId: string): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);

    if (!normalizedSessionId) {
      return;
    }

    this.stopActivePlayback(false);
    this.sessionId = normalizedSessionId;
    this.resetPlaybackEvidence();

    const video = this.elementRef.nativeElement;
    if (!video.paused && !video.seeking && !video.ended) {
      this.startActivePlayback();
    }
  }

  private resetPlaybackEvidence(): void {
    this.mediaPlaybackMs = 0;
    this.activeWallMs = 0;
    this.activeStartedAt = null;
    this.lastMediaTimeMs = this.currentMediaTimeMs();
    this.emitted = false;
  }

  private onLoadedMetadata(): void {
    this.lastMediaTimeMs = this.currentMediaTimeMs();
  }

  private onTimeUpdate(): void {
    this.captureMediaProgress();
    this.evaluateQualification();
  }

  private onSeeked(): void {
    this.lastMediaTimeMs = this.currentMediaTimeMs();

    const video = this.elementRef.nativeElement;
    if (!video.paused && !video.ended) {
      this.startActivePlayback();
    }
  }

  private onEnded(): void {
    this.captureMediaProgress();
    this.stopActivePlayback(false);
    this.evaluateQualification();
  }

  private onVisibilityChange(): void {
    if (this.document.visibilityState === 'hidden') {
      this.stopActivePlayback(true);
      return;
    }

    const video = this.elementRef.nativeElement;
    if (!video.paused && !video.seeking && !video.ended) {
      this.startActivePlayback();
    }
  }

  private startActivePlayback(): void {
    if (
      !this.identity ||
      !this.sessionId ||
      this.emitted ||
      this.document.visibilityState === 'hidden' ||
      this.activeStartedAt !== null
    ) {
      return;
    }

    this.lastMediaTimeMs = this.currentMediaTimeMs();
    this.activeStartedAt = this.now();
  }

  private stopActivePlayback(captureMediaProgress: boolean): void {
    if (captureMediaProgress) {
      this.captureMediaProgress();
    }

    if (this.activeStartedAt !== null) {
      this.activeWallMs += Math.max(0, this.now() - this.activeStartedAt);
      this.activeStartedAt = null;
    }

    this.lastMediaTimeMs = this.currentMediaTimeMs();
  }

  private captureMediaProgress(): void {
    if (this.activeStartedAt === null || this.emitted) {
      return;
    }

    const currentMediaTimeMs = this.currentMediaTimeMs();
    const deltaMs = currentMediaTimeMs - this.lastMediaTimeMs;

    if (deltaMs > 0 && deltaMs <= 5_000) {
      this.mediaPlaybackMs += deltaMs;
    }

    this.lastMediaTimeMs = currentMediaTimeMs;
  }

  private evaluateQualification(): void {
    if (!this.identity || !this.sessionId || this.emitted) {
      return;
    }

    const durationMs = this.currentDurationMs();
    if (durationMs <= 0) {
      return;
    }

    const activeWallMs = this.activeWallMs + (
      this.activeStartedAt === null
        ? 0
        : Math.max(0, this.now() - this.activeStartedAt)
    );
    const qualifiedPlaybackMs = Math.floor(
      Math.min(this.mediaPlaybackMs, activeWallMs)
    );
    const requiredPlaybackMs =
      calculatePublicVideoQualifiedPlaybackMs(durationMs);

    if (qualifiedPlaybackMs < requiredPlaybackMs) {
      return;
    }

    this.emitted = true;
    const detail: PublicVideoQualifiedViewDetail = {
      sessionId: this.sessionId,
      playbackMs: qualifiedPlaybackMs,
      durationMs,
      qualifiedAt: Date.now(),
    };

    this.elementRef.nativeElement.dispatchEvent(
      new CustomEvent<PublicVideoQualifiedViewDetail>(
        'publicVideoQualifiedView',
        {
          detail,
          bubbles: true,
          composed: true,
        }
      )
    );
  }

  private currentMediaTimeMs(): number {
    const currentTime = this.elementRef.nativeElement.currentTime;
    return Number.isFinite(currentTime)
      ? Math.max(0, currentTime * 1000)
      : 0;
  }

  private currentDurationMs(): number {
    const duration = this.elementRef.nativeElement.duration;
    return Number.isFinite(duration) && duration > 0
      ? Math.round(duration * 1000)
      : 0;
  }

  private now(): number {
    return this.document.defaultView?.performance?.now() ?? Date.now();
  }

  private normalizeSessionId(value: unknown): string {
    const sessionId = String(value ?? '').trim();

    return sessionId.length >= 32 &&
      sessionId.length <= 128 &&
      /^[A-Za-z0-9_-]+$/.test(sessionId)
      ? sessionId
      : '';
  }

  private listen(
    target: EventTarget,
    eventName: string,
    listener: EventListener
  ): void {
    target.addEventListener(eventName, listener, { passive: true });
    this.cleanupListeners.push(() => {
      target.removeEventListener(eventName, listener);
    });
  }
}
