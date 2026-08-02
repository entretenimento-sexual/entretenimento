import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  HostBinding,
  HostListener,
  OnDestroy,
  PLATFORM_ID,
  createComponent,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { PublicVideoMetadataPreloadService } from 'src/app/core/services/media/public-video-metadata-preload.service';
import {
  selectAdjacentVideoForPreload,
  type TAdjacentVideoNavigationDirection,
} from './adjacent-video-preload.policy';
import {
  classifyPublicVideoPlaybackFailure,
} from './public-video-playback.policy';

export type TPublicVideoPlaybackFeedbackState =
  | 'hidden'
  | 'loading'
  | 'refreshing'
  | 'error';

interface PublicVideoViewerPreloadData {
  readonly items?: readonly IPublicVideoItem[];
  readonly startIndex?: number;
}

const ADJACENT_PRELOAD_DELAY_MS = 280;
const BUFFERING_FEEDBACK_DELAY_MS = 350;
const SLOW_BUFFERING_MESSAGE_MS = 8_000;
const BUFFERING_FAILURE_MS = 25_000;
const HAVE_CURRENT_DATA = 2;
const OFFLINE_PLAYBACK_MESSAGE =
  'Você está sem conexão. O vídeo será recarregado quando a internet voltar.';
const REPEATED_ACCESS_FAILURE_MESSAGE =
  'O vídeo continua indisponível após a atualização de acesso. Tente novamente mais tarde ou abra outro vídeo.';

@Component({
  selector: 'app-public-video-playback-feedback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() !== 'hidden') {
      <div
        class="playback-feedback"
        [class.playback-feedback--error]="state() === 'error'"
        [attr.role]="state() === 'error' ? 'alert' : 'status'"
        [attr.aria-live]="state() === 'error' ? 'assertive' : 'polite'"
        aria-atomic="true"
      >
        @if (state() === 'error') {
          <span class="playback-feedback__error-icon" aria-hidden="true">!</span>
          <strong>Não foi possível reproduzir</strong>
          <p>{{ message() }}</p>
          <button type="button" (click)="retry.emit()">
            Tentar novamente
          </button>
        } @else {
          <span class="playback-feedback__spinner" aria-hidden="true"></span>
          <strong>{{ message() }}</strong>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      position: absolute;
      z-index: 3;
      inset: 0;
      display: grid;
      place-items: center;
      pointer-events: none;
    }

    .playback-feedback {
      display: grid;
      place-items: center;
      gap: 10px;
      max-width: min(86%, 360px);
      padding: 18px 20px;
      border: 1px solid rgb(255 255 255 / 14%);
      border-radius: 16px;
      background: rgb(5 7 12 / 78%);
      color: #fff;
      text-align: center;
      box-shadow: 0 16px 52px rgb(0 0 0 / 36%);
      backdrop-filter: blur(14px);
    }

    .playback-feedback--error {
      pointer-events: auto;
    }

    .playback-feedback strong,
    .playback-feedback p {
      margin: 0;
    }

    .playback-feedback strong {
      font-size: 0.92rem;
    }

    .playback-feedback p {
      color: rgb(255 255 255 / 72%);
      font-size: 0.8rem;
      line-height: 1.45;
    }

    .playback-feedback__spinner {
      width: 30px;
      height: 30px;
      border: 3px solid rgb(255 255 255 / 26%);
      border-top-color: #fff;
      border-radius: 50%;
      animation: playback-spin 0.8s linear infinite;
    }

    .playback-feedback__error-icon {
      display: inline-grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border: 1px solid rgb(255 112 112 / 66%);
      border-radius: 50%;
      background: rgb(255 80 100 / 18%);
      font-size: 1.1rem;
      font-weight: 850;
    }

    .playback-feedback button {
      min-height: 42px;
      padding: 8px 15px;
      border: 1px solid rgb(255 255 255 / 24%);
      border-radius: 999px;
      background: rgb(255 255 255 / 12%);
      color: #fff;
      font: inherit;
      font-size: 0.84rem;
      font-weight: 760;
      cursor: pointer;
    }

    .playback-feedback button:hover,
    .playback-feedback button:focus-visible {
      border-color: rgb(255 255 255 / 52%);
      background: rgb(255 255 255 / 20%);
    }

    .playback-feedback button:focus-visible {
      outline: 3px solid rgb(255 112 112 / 94%);
      outline-offset: 3px;
    }

    @keyframes playback-spin {
      to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
      .playback-feedback__spinner {
        animation-duration: 1.8s;
      }
    }

    html.high-contrast .playback-feedback,
    html.high-contrast .playback-feedback button {
      border-color: currentColor !important;
      box-shadow: none !important;
    }
  `],
})
export class PublicVideoPlaybackFeedbackComponent {
  readonly state = input.required<TPublicVideoPlaybackFeedbackState>();
  readonly message = input.required<string>();
  readonly retry = output<void>();
}

@Directive({
  selector: 'video.public-video-viewer__video',
  standalone: true,
})
export class PublicVideoPlaybackFeedbackDirective
  implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLVideoElement>);
  private readonly applicationRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly metadataPreload = inject(PublicVideoMetadataPreloadService);
  private readonly viewerData = inject<PublicVideoViewerPreloadData | null>(
    MAT_DIALOG_DATA,
    { optional: true }
  );
  private readonly automaticAccessRecoveryKeys = new Set<string>();

  private readonly feedbackState = signal<TPublicVideoPlaybackFeedbackState>(
    'loading'
  );
  private feedbackMessage = 'Carregando vídeo...';
  private feedbackRef: ComponentRef<PublicVideoPlaybackFeedbackComponent> | null =
    null;
  private retrySubscription: { unsubscribe(): void } | null = null;
  private posterProbe: HTMLImageElement | null = null;
  private adjacentPreloadTimer: ReturnType<typeof setTimeout> | null = null;
  private adjacentPreloadCandidate: IPublicVideoItem | null = null;
  private viewerBodyObserver: MutationObserver | null = null;
  private bufferingFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private slowBufferingTimer: ReturnType<typeof setTimeout> | null = null;
  private bufferingFailureTimer: ReturnType<typeof setTimeout> | null = null;
  private currentItemIndex = -1;
  private preloadDirection: TAdjacentVideoNavigationDirection = 'next';
  private currentPlaybackReady = false;
  private bufferingActive = false;
  private offlineRecoveryPending = false;
  private destroyed = false;

  @HostBinding('attr.aria-busy')
  get ariaBusy(): 'true' | null {
    return this.feedbackState() === 'loading' ||
      this.feedbackState() === 'refreshing'
      ? 'true'
      : null;
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const parent = this.elementRef.nativeElement.parentElement;

    if (!parent) {
      return;
    }

    const hostElement = this.document.createElement(
      'app-public-video-playback-feedback'
    );
    parent.appendChild(hostElement);

    this.feedbackRef = createComponent(PublicVideoPlaybackFeedbackComponent, {
      environmentInjector: this.environmentInjector,
      hostElement,
    });
    this.applicationRef.attachView(this.feedbackRef.hostView);
    this.retrySubscription = this.feedbackRef.instance.retry.subscribe(() => {
      if (!this.isOnline()) {
        this.offlineRecoveryPending = true;
        this.markError(OFFLINE_PLAYBACK_MESSAGE);
        return;
      }

      const recoveryKey = this.currentRecoveryKey();
      if (recoveryKey) {
        this.automaticAccessRecoveryKeys.delete(recoveryKey);
      }

      this.offlineRecoveryPending = false;
      this.markRefreshing('Atualizando acesso ao vídeo...');
      this.dispatch('publicVideoRetry');
    });
    this.currentItemIndex = this.resolveCurrentItemIndex();
    this.observeViewerPanelState();
    this.syncFeedback();
    this.validatePoster();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.posterProbe = null;
    this.finishBufferingFeedback();
    this.cancelAdjacentMetadataPreload();
    this.viewerBodyObserver?.disconnect();
    this.viewerBodyObserver = null;
    this.retrySubscription?.unsubscribe();
    this.retrySubscription = null;

    if (this.feedbackRef) {
      this.applicationRef.detachView(this.feedbackRef.hostView);
      this.feedbackRef.destroy();
      this.feedbackRef = null;
    }
  }

  @HostListener('document:visibilitychange')
  onDocumentVisibilityChange(): void {
    if (this.document.visibilityState !== 'visible') {
      this.cancelAdjacentMetadataPreload();
      return;
    }

    if (this.isOnline()) {
      this.scheduleAdjacentMetadataPreload();
    }
  }

  @HostListener('window:online')
  onWindowOnline(): void {
    if (this.offlineRecoveryPending) {
      const recoveryKey = this.currentRecoveryKey();
      if (recoveryKey) {
        this.automaticAccessRecoveryKeys.delete(recoveryKey);
      }

      this.offlineRecoveryPending = false;
      this.markRefreshing('Conexão restabelecida. Recarregando vídeo...');
      this.dispatch('publicVideoRetry');
      return;
    }

    this.scheduleAdjacentMetadataPreload();
  }

  @HostListener('window:offline')
  onWindowOffline(): void {
    this.cancelAdjacentMetadataPreload();

    if (
      this.bufferingActive ||
      this.feedbackState() === 'loading' ||
      this.feedbackState() === 'refreshing'
    ) {
      this.offlineRecoveryPending = true;
      this.finishBufferingFeedback();
      this.markError(OFFLINE_PLAYBACK_MESSAGE);
    }
  }

  @HostListener('loadstart')
  onLoadStart(): void {
    this.currentPlaybackReady = false;
    this.updateCurrentItemIndex();
    this.cancelAdjacentMetadataPreload();
    this.startBufferingFeedback('Carregando vídeo...', true);
    this.validatePoster();
  }

  @HostListener('waiting')
  @HostListener('stalled')
  onWaiting(): void {
    if (this.feedbackState() === 'refreshing') {
      return;
    }

    this.startBufferingFeedback('Aguardando o vídeo...', false);
  }

  @HostListener('seeking')
  onSeeking(): void {
    if (this.feedbackState() !== 'refreshing') {
      this.startBufferingFeedback('Buscando trecho...', false);
    }
  }

  @HostListener('loadedmetadata')
  onLoadedMetadata(): void {
    this.updateCurrentItemIndex();
    this.validatePoster();
  }

  @HostListener('canplay')
  @HostListener('playing')
  @HostListener('seeked')
  onReady(): void {
    const video = this.elementRef.nativeElement;

    if (
      video.readyState < HAVE_CURRENT_DATA &&
      !video.ended
    ) {
      return;
    }

    this.currentPlaybackReady = true;
    this.offlineRecoveryPending = false;
    this.updateCurrentItemIndex();
    this.finishBufferingFeedback();
    this.markReady();
    this.scheduleAdjacentMetadataPreload();
    this.dispatch('publicVideoReady');
  }

  @HostListener('error')
  onError(): void {
    const video = this.elementRef.nativeElement;
    const failure = classifyPublicVideoPlaybackFailure(
      video.error?.code,
      this.isOnline()
    );

    this.currentPlaybackReady = false;
    this.finishBufferingFeedback();
    this.cancelAdjacentMetadataPreload();

    if (failure.ignored) {
      return;
    }

    this.offlineRecoveryPending = failure.retryWhenOnline;
    this.markError(failure.message);

    if (!failure.shouldRefreshAccess) {
      return;
    }

    const recoveryKey = this.currentRecoveryKey();

    if (
      recoveryKey &&
      this.automaticAccessRecoveryKeys.has(recoveryKey)
    ) {
      this.markError(REPEATED_ACCESS_FAILURE_MESSAGE);
      return;
    }

    if (recoveryKey) {
      this.automaticAccessRecoveryKeys.add(recoveryKey);
    }

    this.dispatch('publicVideoAccessError');
  }

  markLoading(message = 'Carregando vídeo...'): void {
    this.setFeedback('loading', message);
  }

  markRefreshing(message = 'Atualizando acesso ao vídeo...'): void {
    this.finishBufferingFeedback();
    this.cancelAdjacentMetadataPreload();
    this.setFeedback('refreshing', message);
  }

  markReady(): void {
    this.finishBufferingFeedback();
    this.setFeedback('hidden', '');
  }

  markError(message: string): void {
    this.finishBufferingFeedback();
    this.setFeedback('error', message);
  }

  private startBufferingFeedback(message: string, immediate: boolean): void {
    if (this.feedbackState() === 'refreshing') {
      return;
    }

    if (!this.isOnline()) {
      this.offlineRecoveryPending = true;
      this.markError(OFFLINE_PLAYBACK_MESSAGE);
      return;
    }

    if (this.bufferingActive) {
      return;
    }

    this.bufferingActive = true;
    this.cancelAdjacentMetadataPreload();
    this.clearBufferingTimers();

    if (immediate) {
      this.markLoading(message);
      this.bufferingActive = true;
    } else {
      this.bufferingFeedbackTimer = setTimeout(() => {
        this.bufferingFeedbackTimer = null;

        if (this.bufferingActive && !this.destroyed) {
          this.markLoading(message);
          this.bufferingActive = true;
        }
      }, BUFFERING_FEEDBACK_DELAY_MS);
    }

    this.slowBufferingTimer = setTimeout(() => {
      this.slowBufferingTimer = null;

      if (this.bufferingActive && !this.destroyed) {
        this.markLoading(
          'A conexão está lenta. O vídeo ainda está carregando...'
        );
        this.bufferingActive = true;
      }
    }, SLOW_BUFFERING_MESSAGE_MS);

    this.bufferingFailureTimer = setTimeout(() => {
      this.bufferingFailureTimer = null;

      if (!this.bufferingActive || this.destroyed) {
        return;
      }

      this.bufferingActive = false;
      this.clearBufferingTimers();
      this.markError(
        'O carregamento demorou mais que o esperado. Verifique a conexão e tente novamente.'
      );
    }, BUFFERING_FAILURE_MS);
  }

  private finishBufferingFeedback(): void {
    this.bufferingActive = false;
    this.clearBufferingTimers();
  }

  private clearBufferingTimers(): void {
    if (this.bufferingFeedbackTimer !== null) {
      clearTimeout(this.bufferingFeedbackTimer);
      this.bufferingFeedbackTimer = null;
    }

    if (this.slowBufferingTimer !== null) {
      clearTimeout(this.slowBufferingTimer);
      this.slowBufferingTimer = null;
    }

    if (this.bufferingFailureTimer !== null) {
      clearTimeout(this.bufferingFailureTimer);
      this.bufferingFailureTimer = null;
    }
  }

  private setFeedback(
    state: TPublicVideoPlaybackFeedbackState,
    message: string
  ): void {
    this.feedbackState.set(state);
    this.feedbackMessage = message;
    this.syncFeedback();
  }

  private syncFeedback(): void {
    if (!this.feedbackRef || this.destroyed) {
      return;
    }

    this.feedbackRef.setInput('state', this.feedbackState());
    this.feedbackRef.setInput('message', this.feedbackMessage);
    this.feedbackRef.changeDetectorRef.detectChanges();
  }

  private observeViewerPanelState(): void {
    const viewerBody = this.elementRef.nativeElement.closest(
      '.public-video-viewer__body'
    );

    if (!viewerBody || typeof MutationObserver === 'undefined') {
      return;
    }

    this.viewerBodyObserver = new MutationObserver(() => {
      if (this.isViewerPanelOpen()) {
        this.cancelAdjacentMetadataPreload();
        return;
      }

      this.scheduleAdjacentMetadataPreload();
    });
    this.viewerBodyObserver.observe(viewerBody, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  private updateCurrentItemIndex(): void {
    const nextIndex = this.resolveCurrentItemIndex();

    if (nextIndex < 0) {
      return;
    }

    if (this.currentItemIndex >= 0 && nextIndex !== this.currentItemIndex) {
      this.preloadDirection = nextIndex < this.currentItemIndex
        ? 'previous'
        : 'next';
    }

    this.currentItemIndex = nextIndex;
  }

  private resolveCurrentItemIndex(): number {
    const items = this.viewerData?.items ?? [];
    const video = this.elementRef.nativeElement;
    const currentIdentity = this.assetIdentity(
      video.currentSrc || video.getAttribute('src') || video.src
    );

    if (currentIdentity) {
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

    return this.normalizeStartIndex(items.length);
  }

  private normalizeStartIndex(itemsCount: number): number {
    if (itemsCount <= 0) {
      return -1;
    }

    const startIndex = Number(this.viewerData?.startIndex ?? 0);
    const normalized = Number.isFinite(startIndex) ? Math.trunc(startIndex) : 0;
    return Math.max(0, Math.min(normalized, itemsCount - 1));
  }

  private currentRecoveryKey(): string {
    const items = this.viewerData?.items ?? [];
    const item = items[this.currentItemIndex];
    const ownerUid = String(item?.ownerUid ?? '').trim();
    const videoId = String(item?.id ?? '').trim();

    return ownerUid && videoId ? `${ownerUid}:${videoId}` : '';
  }

  private scheduleAdjacentMetadataPreload(): void {
    this.clearAdjacentPreloadTimer();

    if (!this.canScheduleAdjacentMetadataPreload()) {
      return;
    }

    this.adjacentPreloadTimer = setTimeout(() => {
      this.adjacentPreloadTimer = null;
      this.preloadAdjacentMetadata();
    }, ADJACENT_PRELOAD_DELAY_MS);
  }

  private canScheduleAdjacentMetadataPreload(): boolean {
    return this.currentPlaybackReady &&
      this.isOnline() &&
      this.document.visibilityState === 'visible' &&
      !this.destroyed &&
      !this.isViewerPanelOpen();
  }

  private preloadAdjacentMetadata(): void {
    if (!this.canScheduleAdjacentMetadataPreload()) {
      return;
    }

    const candidate = selectAdjacentVideoForPreload(
      this.viewerData?.items ?? [],
      this.currentItemIndex,
      this.preloadDirection
    );

    if (candidate && this.metadataPreload.preloadMetadata(candidate)) {
      this.adjacentPreloadCandidate = candidate;
    }
  }

  private cancelAdjacentMetadataPreload(): void {
    this.clearAdjacentPreloadTimer();

    if (!this.adjacentPreloadCandidate) {
      return;
    }

    this.metadataPreload.cancelMetadataPreload(
      this.adjacentPreloadCandidate
    );
    this.adjacentPreloadCandidate = null;
  }

  private clearAdjacentPreloadTimer(): void {
    if (this.adjacentPreloadTimer === null) {
      return;
    }

    clearTimeout(this.adjacentPreloadTimer);
    this.adjacentPreloadTimer = null;
  }

  private isViewerPanelOpen(): boolean {
    return this.elementRef.nativeElement.closest(
      '.public-video-viewer__body'
    )?.classList.contains('public-video-viewer__body--panel-open') === true;
  }

  private assetIdentity(value: string): string {
    const normalized = String(value ?? '').trim();

    if (!normalized) {
      return '';
    }

    try {
      const parsed = new URL(normalized, this.document.baseURI);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return normalized.split('?')[0]?.split('#')[0] ?? normalized;
    }
  }

  private validatePoster(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const video = this.elementRef.nativeElement;
    const posterUrl = video.getAttribute('poster')?.trim() || '';

    if (!posterUrl) {
      this.posterProbe = null;
      return;
    }

    const probe = new Image();
    this.posterProbe = probe;

    probe.onload = () => {
      if (this.posterProbe === probe) {
        this.posterProbe = null;
      }
    };
    probe.onerror = () => {
      if (this.posterProbe !== probe || this.destroyed) {
        return;
      }

      this.posterProbe = null;
      if (video.getAttribute('poster') === posterUrl) {
        video.removeAttribute('poster');
        this.dispatch('publicVideoPosterError');
      }
    };
    probe.src = posterUrl;
  }

  private isOnline(): boolean {
    if (typeof navigator === 'undefined') {
      return true;
    }

    return navigator.onLine !== false;
  }

  private dispatch(eventName: string): void {
    this.elementRef.nativeElement.dispatchEvent(new CustomEvent(eventName, {
      bubbles: true,
      composed: true,
    }));
  }
}
