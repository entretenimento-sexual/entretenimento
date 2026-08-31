// src/app/core/components/public-user-preview-popover/public-user-preview-trigger.directive.ts
import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Directive,
  ElementRef,
  ViewContainerRef,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  ConnectedPosition,
  Overlay,
  OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import type { PublicUserPreview } from '../../domain/public-user-preview/public-user-preview.model';
import { PublicUserPreviewPopoverComponent } from './public-user-preview-popover.component';

/**
 * A prévia transitória permanece visualmente vinculada ao card de origem.
 *
 * No desktop ela é centralizada sobre o próprio card. Como o hover dura pouco,
 * essa associação direta reduz deslocamento visual e evita que a prévia pareça
 * pertencer ao card vizinho ou a outra área da grade. O CDK usa `withPush(true)`
 * apenas para impedir corte nas bordas do viewport.
 */
const DESKTOP_POSITIONS: readonly ConnectedPosition[] = [
  {
    originX: 'center',
    originY: 'center',
    overlayX: 'center',
    overlayY: 'center',
  },
];

@Directive({
  selector: '[appPublicUserPreviewTrigger]',
  standalone: true,
  exportAs: 'publicUserPreviewTrigger',
  host: {
    '(pointerenter)': 'onPointerEnter($event)',
    '(pointerleave)': 'onPointerLeave()',
  },
})
export class PublicUserPreviewTriggerDirective {
  readonly appPublicUserPreviewTrigger = input<PublicUserPreview | null>(null);
  readonly publicUserPreviewRelationship = input<string | null>(null);
  readonly publicUserPreviewProfileRoute = input<readonly string[] | null>(null);
  readonly isOpen = signal(false);

  private readonly overlay = inject(Overlay);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  private overlayRef: OverlayRef | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private returnFocusTarget: HTMLElement | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.disposeOverlay());
  }

  onPointerEnter(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
      return;
    }

    this.scheduleOpen();
  }

  onPointerLeave(): void {
    this.scheduleClose();
  }

  open(): void {
    this.clearOpenTimer();
    this.clearCloseTimer();

    const preview = this.appPublicUserPreviewTrigger();
    if (!preview) return;

    if (this.overlayRef?.hasAttached()) {
      return;
    }

    const activeElement = this.document.activeElement as HTMLElement | null;
    this.returnFocusTarget = activeElement
      && activeElement !== this.document.body
      && activeElement !== this.document.documentElement
      && typeof activeElement.focus === 'function'
      ? activeElement
      : null;

    this.disposeOverlay();
    const isCoarsePointer = this.isCoarsePointer();
    const positionStrategy = isCoarsePointer
      ? this.overlay.position()
          .global()
          .centerHorizontally()
          .bottom('calc(1rem + env(safe-area-inset-bottom, 0px))')
      : this.overlay.position()
          .flexibleConnectedTo(this.elementRef)
          .withPositions([...DESKTOP_POSITIONS])
          .withPush(true)
          .withViewportMargin(12)
          .withFlexibleDimensions(false);

    const overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: false,
      disposeOnNavigation: true,
      panelClass: isCoarsePointer
        ? 'public-user-preview-overlay--touch'
        : 'public-user-preview-overlay--desktop',
    });
    this.overlayRef = overlayRef;

    const componentRef = overlayRef.attach(
      new ComponentPortal(
        PublicUserPreviewPopoverComponent,
        this.viewContainerRef
      )
    );
    componentRef.setInput('preview', preview);
    componentRef.setInput(
      'relationshipLabel',
      this.publicUserPreviewRelationship()
    );
    componentRef.setInput(
      'profileRoute',
      this.publicUserPreviewProfileRoute()
    );
    this.isOpen.set(true);

    overlayRef.outsidePointerEvents()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.close());
    overlayRef.keydownEvents()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        const focusTarget = this.returnFocusTarget;
        this.close();
        focusTarget?.focus({ preventScroll: true });
      });
    overlayRef.detachments()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.overlayRef === overlayRef) {
          this.overlayRef = null;
          this.isOpen.set(false);
        }
      });

    overlayRef.overlayElement.addEventListener(
      'pointerenter',
      this.handleOverlayPointerEnter
    );
    overlayRef.overlayElement.addEventListener(
      'pointerleave',
      this.handleOverlayPointerLeave
    );
  }

  toggle(): void {
    if (this.overlayRef?.hasAttached()) {
      this.close();
      return;
    }

    this.open();
  }

  close(): void {
    this.clearOpenTimer();
    this.clearCloseTimer();
    this.disposeOverlay();
  }

  private scheduleOpen(): void {
    this.clearCloseTimer();
    if (this.overlayRef?.hasAttached() || this.openTimer) return;

    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      this.open();
    }, 340);
  }

  private scheduleClose(): void {
    this.clearOpenTimer();
    this.clearCloseTimer();
    if (!this.overlayRef?.hasAttached()) return;

    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      this.close();
    }, 180);
  }

  private readonly handleOverlayPointerEnter = (): void => {
    this.clearCloseTimer();
  };

  private readonly handleOverlayPointerLeave = (): void => {
    this.scheduleClose();
  };

  private isCoarsePointer(): boolean {
    try {
      return globalThis.matchMedia?.('(hover: none), (pointer: coarse)').matches
        === true;
    } catch {
      return false;
    }
  }

  private disposeOverlay(): void {
    const overlayRef = this.overlayRef;
    this.overlayRef = null;
    this.isOpen.set(false);
    if (!overlayRef) return;

    overlayRef.overlayElement.removeEventListener(
      'pointerenter',
      this.handleOverlayPointerEnter
    );
    overlayRef.overlayElement.removeEventListener(
      'pointerleave',
      this.handleOverlayPointerLeave
    );
    overlayRef.dispose();
  }

  private clearOpenTimer(): void {
    if (!this.openTimer) return;
    clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private clearCloseTimer(): void {
    if (!this.closeTimer) return;
    clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }
}
