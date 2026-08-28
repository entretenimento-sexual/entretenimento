import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  DestroyRef,
  EnvironmentInjector,
  Injectable,
  PLATFORM_ID,
  createComponent,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, fromEvent, merge } from 'rxjs';
import {
  filter,
  finalize,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs/operators';

export type TPublicVideoSwipeFeedbackDirection = 'next' | 'previous';

export interface PublicVideoSwipeFeedbackState {
  readonly direction: TPublicVideoSwipeFeedbackDirection | null;
  readonly progress: number;
  readonly ready: boolean;
  readonly available: boolean;
  readonly label: string;
}

export interface PublicVideoSwipeFeedbackInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly canNavigateNext: boolean;
  readonly canNavigatePrevious: boolean;
}

const SWIPE_MIN_DISTANCE_PX = 64;
const SWIPE_INTENT_DISTANCE_PX = 18;
const SWIPE_AXIS_DOMINANCE = 1.2;
const SWIPE_BLOCKED_TARGET_SELECTOR = [
  'video',
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'option',
  'label',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="slider"]',
].join(',');

const IDLE_SWIPE_FEEDBACK: PublicVideoSwipeFeedbackState = Object.freeze({
  direction: null,
  progress: 0,
  ready: false,
  available: false,
  label: '',
});

export function resolvePublicVideoSwipeFeedback(
  input: PublicVideoSwipeFeedbackInput
): PublicVideoSwipeFeedbackState {
  const deltaX = Number(input.deltaX);
  const deltaY = Number(input.deltaY);

  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return IDLE_SWIPE_FEEDBACK;
  }

  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);

  if (
    verticalDistance < SWIPE_INTENT_DISTANCE_PX ||
    verticalDistance <= horizontalDistance * SWIPE_AXIS_DOMINANCE
  ) {
    return IDLE_SWIPE_FEEDBACK;
  }

  const direction: TPublicVideoSwipeFeedbackDirection =
    deltaY < 0 ? 'next' : 'previous';
  const available = direction === 'next'
    ? input.canNavigateNext
    : input.canNavigatePrevious;
  const progress = Math.min(1, verticalDistance / SWIPE_MIN_DISTANCE_PX);
  const ready = available && progress >= 1;

  let label: string;

  if (!available) {
    label = direction === 'next' ? 'Fim da galeria' : 'Início da galeria';
  } else if (ready) {
    label = direction === 'next'
      ? 'Solte para abrir o próximo vídeo'
      : 'Solte para abrir o vídeo anterior';
  } else {
    label = direction === 'next'
      ? 'Continue deslizando para o próximo vídeo'
      : 'Continue deslizando para o vídeo anterior';
  }

  return {
    direction,
    progress,
    ready,
    available,
    label,
  };
}

@Component({
  selector: 'app-public-video-swipe-feedback',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state().direction; as direction) {
      <div
        class="swipe-feedback"
        [class.swipe-feedback--next]="direction === 'next'"
        [class.swipe-feedback--previous]="direction === 'previous'"
        [class.swipe-feedback--ready]="state().ready"
        [class.swipe-feedback--unavailable]="!state().available"
        aria-hidden="true"
      >
        <span class="swipe-feedback__icon">
          {{ direction === 'next' ? '↑' : '↓' }}
        </span>

        <span class="swipe-feedback__content">
          <strong>{{ state().label }}</strong>
          <span class="swipe-feedback__track">
            <span
              class="swipe-feedback__progress"
              [style.width.%]="state().progress * 100"
            ></span>
          </span>
        </span>
      </div>
    }
  `,
  styles: [`
    :host {
      position: absolute;
      z-index: 7;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      contain: layout style paint;
    }

    .swipe-feedback {
      position: absolute;
      left: 50%;
      display: flex;
      align-items: center;
      gap: 10px;
      width: min(82%, 340px);
      min-height: 52px;
      padding: 10px 13px;
      border: 1px solid rgb(255 255 255 / 22%);
      border-radius: 16px;
      background: rgb(5 7 12 / 82%);
      color: #fff;
      box-shadow: 0 14px 42px rgb(0 0 0 / 34%);
      transform: translateX(-50%);
      backdrop-filter: blur(16px);
      transition:
        border-color 140ms ease,
        background-color 140ms ease,
        opacity 140ms ease;
    }

    .swipe-feedback--previous {
      top: max(86px, calc(env(safe-area-inset-top) + 72px));
    }

    .swipe-feedback--next {
      bottom: max(150px, calc(env(safe-area-inset-bottom) + 136px));
    }

    .swipe-feedback--ready {
      border-color: rgb(255 112 112 / 76%);
      background: rgb(36 12 18 / 88%);
    }

    .swipe-feedback--unavailable {
      opacity: 0.7;
    }

    .swipe-feedback__icon {
      display: inline-grid;
      flex: 0 0 auto;
      place-items: center;
      width: 34px;
      height: 34px;
      border: 1px solid rgb(255 255 255 / 24%);
      border-radius: 50%;
      background: rgb(255 255 255 / 10%);
      font-size: 1.08rem;
      font-weight: 850;
    }

    .swipe-feedback__content {
      display: grid;
      flex: 1 1 auto;
      gap: 7px;
      min-width: 0;
    }

    .swipe-feedback strong {
      overflow: hidden;
      font-size: 0.78rem;
      font-weight: 760;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .swipe-feedback__track {
      display: block;
      width: 100%;
      height: 4px;
      overflow: hidden;
      border-radius: 999px;
      background: rgb(255 255 255 / 18%);
    }

    .swipe-feedback__progress {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: currentColor;
      transition: width 60ms linear;
    }

    .swipe-feedback--unavailable .swipe-feedback__progress {
      opacity: 0.35;
    }

    @media (prefers-reduced-motion: reduce) {
      .swipe-feedback,
      .swipe-feedback__progress {
        transition: none;
      }
    }

    :host-context(html.high-contrast) .swipe-feedback,
    :host-context(html.high-contrast) .swipe-feedback__icon {
      border-color: currentColor !important;
      box-shadow: none !important;
    }
  `],
})
export class PublicVideoSwipeFeedbackComponent {
  readonly state = input.required<PublicVideoSwipeFeedbackState>();
}

interface ActiveSwipeContext {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly stage: HTMLElement;
}

@Injectable({ providedIn: 'root' })
export class PublicVideoSwipeFeedbackService {
  private readonly applicationRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  private feedbackRef: ComponentRef<PublicVideoSwipeFeedbackComponent> | null =
    null;
  private feedbackHost: HTMLElement | null = null;
  private started = false;

  start(): void {
    if (this.started || !isPlatformBrowser(this.platformId)) {
      return;
    }

    this.started = true;

    fromEvent<PointerEvent>(this.document, 'pointerdown', {
      capture: true,
      passive: true,
    })
      .pipe(
        filter((event) => this.canStartGesture(event)),
        switchMap((event) => this.trackGesture(event)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.destroyRef.onDestroy(() => this.destroyFeedback());
  }

  private trackGesture(event: PointerEvent): Observable<PointerEvent> {
    const stage = this.resolveStage(event.target);

    if (!stage) {
      return EMPTY;
    }

    const context: ActiveSwipeContext = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      stage,
    };

    this.mountFeedback(stage);

    const finish$ = merge(
      fromEvent<PointerEvent>(this.document, 'pointerup', {
        capture: true,
        passive: true,
      }),
      fromEvent<PointerEvent>(this.document, 'pointercancel', {
        capture: true,
        passive: true,
      })
    ).pipe(
      filter((candidate) => candidate.pointerId === context.pointerId),
      take(1)
    );

    return fromEvent<PointerEvent>(this.document, 'pointermove', {
      capture: true,
      passive: true,
    }).pipe(
      filter((candidate) => candidate.pointerId === context.pointerId),
      tap((candidate) => this.updateFeedback(context, candidate)),
      takeUntil(finish$),
      finalize(() => this.destroyFeedback())
    );
  }

  private updateFeedback(
    context: ActiveSwipeContext,
    event: PointerEvent
  ): void {
    if (!context.stage.isConnected || this.isPanelOpen(context.stage)) {
      this.renderFeedback(IDLE_SWIPE_FEEDBACK);
      return;
    }

    const availability = this.readNavigationAvailability(context.stage);
    const state = resolvePublicVideoSwipeFeedback({
      deltaX: event.clientX - context.startX,
      deltaY: event.clientY - context.startY,
      canNavigateNext: availability.next,
      canNavigatePrevious: availability.previous,
    });

    this.renderFeedback(state);
  }

  private canStartGesture(event: PointerEvent): boolean {
    const pointerType = String(event.pointerType ?? '').trim().toLowerCase();
    const stage = this.resolveStage(event.target);

    if (
      pointerType === 'mouse' ||
      event.isPrimary === false ||
      event.button !== 0 ||
      !stage ||
      this.isPanelOpen(stage)
    ) {
      return false;
    }

    const target = event.target;
    const availability = this.readNavigationAvailability(stage);

    return (availability.previous || availability.next) &&
      target instanceof Element &&
      !target.closest(SWIPE_BLOCKED_TARGET_SELECTOR);
  }

  private resolveStage(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) {
      return null;
    }

    const stage = target.closest('.public-video-viewer__stage');
    return stage instanceof HTMLElement ? stage : null;
  }

  private isPanelOpen(stage: HTMLElement): boolean {
    return stage.closest('.public-video-viewer__body')
      ?.classList.contains('public-video-viewer__body--panel-open') === true;
  }

  private readNavigationAvailability(stage: HTMLElement): {
    previous: boolean;
    next: boolean;
  } {
    const previousButton = stage.querySelector<HTMLButtonElement>(
      '[aria-label="Abrir vídeo anterior"]'
    );
    const nextButton = stage.querySelector<HTMLButtonElement>(
      '[aria-label="Abrir próximo vídeo"]'
    );

    return {
      previous: !!previousButton && !previousButton.disabled,
      next: !!nextButton && !nextButton.disabled,
    };
  }

  private mountFeedback(stage: HTMLElement): void {
    this.destroyFeedback();

    const host = this.document.createElement('app-public-video-swipe-feedback');
    stage.appendChild(host);

    this.feedbackHost = host;
    this.feedbackRef = createComponent(PublicVideoSwipeFeedbackComponent, {
      environmentInjector: this.environmentInjector,
      hostElement: host,
    });
    this.feedbackRef.setInput('state', IDLE_SWIPE_FEEDBACK);
    this.applicationRef.attachView(this.feedbackRef.hostView);
    this.feedbackRef.changeDetectorRef.detectChanges();
  }

  private renderFeedback(state: PublicVideoSwipeFeedbackState): void {
    if (!this.feedbackRef) {
      return;
    }

    this.feedbackRef.setInput('state', state);
    this.feedbackRef.changeDetectorRef.detectChanges();
  }

  private destroyFeedback(): void {
    if (this.feedbackRef) {
      this.applicationRef.detachView(this.feedbackRef.hostView);
      this.feedbackRef.destroy();
      this.feedbackRef = null;
    }

    this.feedbackHost?.remove();
    this.feedbackHost = null;
  }
}
