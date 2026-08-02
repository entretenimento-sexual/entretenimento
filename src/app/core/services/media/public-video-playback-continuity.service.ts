import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';

import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import {
  PUBLIC_VIDEO_METADATA_PRELOAD_CAPABILITY_READER,
  PublicVideoMetadataPreloadCapability,
  canPreloadPublicVideoMetadata,
} from './public-video-playback-capability';

interface PublicVideoAudioPreference {
  readonly volume: number;
  readonly muted: boolean;
}

interface NetworkInformationLike extends EventTarget {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
  readonly downlink?: number;
}

interface NavigatorWithConnection extends Navigator {
  readonly connection?: NetworkInformationLike;
  readonly mozConnection?: NetworkInformationLike;
  readonly webkitConnection?: NetworkInformationLike;
}

const PUBLIC_VIDEO_SELECTOR = 'video.public-video-viewer__video';
const AUDIO_PREFERENCE_STORAGE_KEY = 'public-video-audio-preference.v1';
const DIRECT_MEDIA_INTERACTION_WINDOW_MS = 900;

export function canUsePublicVideoContinuousPlayback(
  capability: PublicVideoMetadataPreloadCapability
): boolean {
  return canPreloadPublicVideoMetadata(capability);
}

export function publicVideoAssetIdentity(
  value: string | null | undefined,
  baseUri = 'http://localhost/'
): string {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized, baseUri);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return normalized.split('?')[0]?.split('#')[0] ?? normalized;
  }
}

@Injectable({ providedIn: 'root' })
export class PublicVideoPlaybackContinuityService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly readCapability = inject(
    PUBLIC_VIDEO_METADATA_PRELOAD_CAPABILITY_READER
  );

  private readonly assetIdentities = new WeakMap<HTMLVideoElement, string>();
  private readonly playbackIntent = new WeakSet<HTMLVideoElement>();
  private readonly pendingContinuousPlayback = new WeakSet<HTMLVideoElement>();
  private readonly resumeWhenVisible = new WeakSet<HTMLVideoElement>();
  private readonly applyingAudioPreference = new WeakSet<HTMLVideoElement>();
  private readonly lastDirectMediaInteractionAt =
    new WeakMap<HTMLVideoElement, number>();

  private networkInformation: NetworkInformationLike | null = null;
  private audioPreference: PublicVideoAudioPreference = {
    volume: 1,
    muted: false,
  };
  private activated = false;

  activate(): void {
    if (this.activated || !isPlatformBrowser(this.platformId)) {
      return;
    }

    if (typeof this.document.addEventListener !== 'function') {
      return;
    }

    this.activated = true;
    this.audioPreference = this.restoreAudioPreference();
    this.networkInformation = this.resolveNetworkInformation();

    this.listen('loadstart', (event) => this.onLoadStart(event));
    this.listen('loadedmetadata', (event) => this.onLoadedMetadata(event));
    this.listen('canplay', (event) => this.onCanPlay(event));
    this.listen('play', (event) => this.onPlay(event));
    this.listen('playing', (event) => this.onPlay(event));
    this.listen('pause', (event) => this.onPause(event));
    this.listen('ended', (event) => this.onEnded(event));
    this.listen('volumechange', (event) => this.onVolumeChange(event));
    this.listen('pointerdown', (event) => this.onDirectMediaInteraction(event));
    this.listen('keydown', (event) => this.onDirectMediaInteraction(event));

    fromEvent(this.document, 'visibilitychange')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.onVisibilityChange());

    const windowLike = this.document.defaultView;
    if (windowLike) {
      fromEvent(windowLike, 'pagehide')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.pauseAll(false));
    }

    if (this.networkInformation) {
      fromEvent(this.networkInformation, 'change')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.onNetworkCapabilityChange());
    }

    queueMicrotask(() => this.synchronizeManagedVideos());
  }

  private listen(
    eventName: string,
    handler: (event: Event) => void
  ): void {
    fromEvent(this.document, eventName, { capture: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => handler(event));
  }

  private onLoadStart(event: Event): void {
    const video = this.resolveManagedVideo(event.target);
    if (!video) {
      return;
    }

    const nextIdentity = this.currentAssetIdentity(video);
    const previousIdentity = this.assetIdentities.get(video) ?? '';
    const changedVideo = !!previousIdentity &&
      !!nextIdentity &&
      previousIdentity !== nextIdentity;

    if (
      changedVideo &&
      this.playbackIntent.has(video) &&
      canUsePublicVideoContinuousPlayback(this.readCapability())
    ) {
      this.pendingContinuousPlayback.add(video);
    } else {
      this.pendingContinuousPlayback.delete(video);
    }

    if (nextIdentity) {
      this.assetIdentities.set(video, nextIdentity);
    }

    this.applyAudioPreference(video);
    this.configureNetworkAwarePreload(video);
  }

  private onLoadedMetadata(event: Event): void {
    const video = this.resolveManagedVideo(event.target);
    if (!video) {
      return;
    }

    this.applyAudioPreference(video);
    this.configureNetworkAwarePreload(video);
  }

  private onCanPlay(event: Event): void {
    const video = this.resolveManagedVideo(event.target);

    if (!video || !this.pendingContinuousPlayback.has(video)) {
      return;
    }

    this.pendingContinuousPlayback.delete(video);

    if (!canUsePublicVideoContinuousPlayback(this.readCapability())) {
      this.debug('continuous-playback-skipped', video, 'capability');
      return;
    }

    this.attemptPlayback(video, 'navigation');
  }

  private onPlay(event: Event): void {
    const video = this.resolveManagedVideo(event.target);
    if (!video) {
      return;
    }

    this.playbackIntent.add(video);
    this.pendingContinuousPlayback.delete(video);
    this.resumeWhenVisible.delete(video);
    this.pauseOtherManagedVideos(video);
  }

  private onPause(event: Event): void {
    const video = this.resolveManagedVideo(event.target);
    if (!video || video.ended) {
      return;
    }

    const directInteractionAt =
      this.lastDirectMediaInteractionAt.get(video) ?? 0;

    if (Date.now() - directInteractionAt <= DIRECT_MEDIA_INTERACTION_WINDOW_MS) {
      this.playbackIntent.delete(video);
      this.pendingContinuousPlayback.delete(video);
    }
  }

  private onEnded(event: Event): void {
    const video = this.resolveManagedVideo(event.target);
    if (!video) {
      return;
    }

    this.playbackIntent.delete(video);
    this.pendingContinuousPlayback.delete(video);
    this.resumeWhenVisible.delete(video);
  }

  private onVolumeChange(event: Event): void {
    const video = this.resolveManagedVideo(event.target);

    if (!video || this.applyingAudioPreference.has(video)) {
      return;
    }

    this.audioPreference = {
      volume: this.normalizeVolume(video.volume),
      muted: video.muted,
    };
    this.persistAudioPreference();
  }

  private onDirectMediaInteraction(event: Event): void {
    const video = this.resolveManagedVideo(event.target);
    if (!video) {
      return;
    }

    if (event instanceof KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (![' ', 'enter', 'k', 'm', 'arrowleft', 'arrowright'].includes(key)) {
        return;
      }
    }

    this.lastDirectMediaInteractionAt.set(video, Date.now());
  }

  private onVisibilityChange(): void {
    if (this.document.visibilityState === 'hidden') {
      this.pauseAll(true);
      return;
    }

    for (const video of this.managedVideos()) {
      if (!this.resumeWhenVisible.has(video)) {
        continue;
      }

      this.resumeWhenVisible.delete(video);
      this.attemptPlayback(video, 'visibility');
    }
  }

  private onNetworkCapabilityChange(): void {
    const capability = this.readCapability();

    for (const video of this.managedVideos()) {
      this.configureNetworkAwarePreload(video, capability);

      if (!canUsePublicVideoContinuousPlayback(capability)) {
        this.pendingContinuousPlayback.delete(video);
      }
    }
  }

  private synchronizeManagedVideos(): void {
    const capability = this.readCapability();

    for (const video of this.managedVideos()) {
      const identity = this.currentAssetIdentity(video);
      if (identity) {
        this.assetIdentities.set(video, identity);
      }
      this.applyAudioPreference(video);
      this.configureNetworkAwarePreload(video, capability);
    }
  }

  private pauseAll(resumeWhenVisible: boolean): void {
    for (const video of this.managedVideos()) {
      this.pendingContinuousPlayback.delete(video);

      if (video.paused || video.ended) {
        continue;
      }

      if (resumeWhenVisible && this.playbackIntent.has(video)) {
        this.resumeWhenVisible.add(video);
      } else {
        this.resumeWhenVisible.delete(video);
      }

      this.pauseSafely(video);
    }
  }

  private pauseOtherManagedVideos(activeVideo: HTMLVideoElement): void {
    for (const video of this.managedVideos()) {
      if (video === activeVideo || video.paused || video.ended) {
        continue;
      }

      this.pendingContinuousPlayback.delete(video);
      this.resumeWhenVisible.delete(video);
      this.pauseSafely(video);
    }
  }

  private attemptPlayback(
    video: HTMLVideoElement,
    reason: 'navigation' | 'visibility'
  ): void {
    if (
      this.document.visibilityState === 'hidden' ||
      this.readCapability().online === false
    ) {
      return;
    }

    let result: Promise<void> | void;

    try {
      result = video.play();
    } catch (error) {
      this.debug('playback-start-failed', video, { reason, error });
      return;
    }

    void Promise.resolve(result).catch((error) => {
      this.debug('playback-policy-blocked', video, { reason, error });
    });
  }

  private pauseSafely(video: HTMLVideoElement): void {
    try {
      video.pause();
    } catch (error) {
      this.debug('pause-failed', video, error);
    }
  }

  private configureNetworkAwarePreload(
    video: HTMLVideoElement,
    capability = this.readCapability()
  ): void {
    video.preload = canPreloadPublicVideoMetadata(capability)
      ? 'metadata'
      : 'none';
  }

  private applyAudioPreference(video: HTMLVideoElement): void {
    this.applyingAudioPreference.add(video);

    try {
      video.volume = this.normalizeVolume(this.audioPreference.volume);
      video.muted = this.audioPreference.muted;
    } finally {
      this.applyingAudioPreference.delete(video);
    }
  }

  private restoreAudioPreference(): PublicVideoAudioPreference {
    const storage = this.document.defaultView?.sessionStorage;

    if (!storage) {
      return this.audioPreference;
    }

    try {
      const raw = storage.getItem(AUDIO_PREFERENCE_STORAGE_KEY);
      if (!raw) {
        return this.audioPreference;
      }

      const parsed = JSON.parse(raw) as Partial<PublicVideoAudioPreference>;
      return {
        volume: this.normalizeVolume(parsed.volume),
        muted: parsed.muted === true,
      };
    } catch {
      return this.audioPreference;
    }
  }

  private persistAudioPreference(): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(
        AUDIO_PREFERENCE_STORAGE_KEY,
        JSON.stringify(this.audioPreference)
      );
    } catch {
      // sessionStorage pode estar bloqueado pelo navegador.
    }
  }

  private normalizeVolume(value: number | null | undefined): number {
    const normalized = Number(value ?? 1);

    if (!Number.isFinite(normalized)) {
      return 1;
    }

    return Math.max(0, Math.min(1, normalized));
  }

  private currentAssetIdentity(video: HTMLVideoElement): string {
    return publicVideoAssetIdentity(
      video.getAttribute('src') || video.currentSrc || video.src,
      this.document.baseURI
    );
  }

  private managedVideos(): HTMLVideoElement[] {
    if (typeof this.document.querySelectorAll !== 'function') {
      return [];
    }

    return Array.from(
      this.document.querySelectorAll<HTMLVideoElement>(PUBLIC_VIDEO_SELECTOR)
    );
  }

  private resolveManagedVideo(target: EventTarget | null): HTMLVideoElement | null {
    if (!(target instanceof HTMLVideoElement)) {
      return null;
    }

    return target.matches(PUBLIC_VIDEO_SELECTOR) ? target : null;
  }

  private resolveNetworkInformation(): NetworkInformationLike | null {
    const navigatorLike = this.document.defaultView?.navigator as
      NavigatorWithConnection | undefined;

    return navigatorLike?.connection ??
      navigatorLike?.mozConnection ??
      navigatorLike?.webkitConnection ??
      null;
  }

  private debug(
    event: string,
    video: HTMLVideoElement,
    extra?: unknown
  ): void {
    this.privacyDebug.log('media', `VideoPlaybackContinuity: ${event}`, {
      hasSource: !!this.currentAssetIdentity(video),
      ...(extra === undefined ? {} : { extra }),
    });
  }
}
