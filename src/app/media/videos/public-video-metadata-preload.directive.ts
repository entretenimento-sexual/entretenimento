import {
  Directive,
  HostListener,
  inject,
  input,
} from '@angular/core';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { PublicVideoMetadataPreloadService } from 'src/app/core/services/media/public-video-metadata-preload.service';

interface TouchIntent {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
}

const TOUCH_MOVE_TOLERANCE_PX = 12;

@Directive({
  selector: '[appPublicVideoMetadataPreload]',
  standalone: true,
})
export class PublicVideoMetadataPreloadDirective {
  readonly item = input.required<IPublicVideoItem>({
    alias: 'appPublicVideoMetadataPreload',
  });

  private readonly preload = inject(PublicVideoMetadataPreloadService);
  private touchIntent: TouchIntent | null = null;

  @HostListener('pointerenter', ['$event'])
  onPointerEnter(event: PointerEvent): void {
    const pointerType = String(event.pointerType ?? '').toLowerCase();

    if (pointerType === 'mouse' || pointerType === 'pen') {
      this.preloadCurrent();
    }
  }

  @HostListener('focusin')
  onFocusIn(): void {
    this.preloadCurrent();
  }

  @HostListener('pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (
      String(event.pointerType ?? '').toLowerCase() !== 'touch' ||
      event.isPrimary === false ||
      event.button !== 0
    ) {
      this.touchIntent = null;
      return;
    }

    this.touchIntent = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  @HostListener('pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    const intent = this.touchIntent;

    if (!intent || intent.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - intent.startX,
      event.clientY - intent.startY
    );

    if (distance > TOUCH_MOVE_TOLERANCE_PX) {
      this.touchIntent = null;
    }
  }

  @HostListener('pointerup', ['$event'])
  onPointerUp(event: PointerEvent): void {
    const intent = this.touchIntent;
    this.touchIntent = null;

    if (!intent || intent.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - intent.startX,
      event.clientY - intent.startY
    );

    if (distance <= TOUCH_MOVE_TOLERANCE_PX) {
      this.preloadCurrent();
    }
  }

  @HostListener('pointercancel')
  cancelTouchIntent(): void {
    this.touchIntent = null;
  }

  private preloadCurrent(): void {
    this.preload.preloadMetadata(this.item());
  }
}
