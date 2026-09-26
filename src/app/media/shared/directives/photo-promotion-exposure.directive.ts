import {
  AfterViewInit,
  Directive,
  ElementRef,
  Input,
  OnDestroy,
  inject,
} from '@angular/core';

import { PhotoPromotionPlacementService } from 'src/app/core/services/media/photo-promotion-placement.service';

@Directive({
  selector: '[appPhotoPromotionExposure]',
  standalone: true,
})
export class PhotoPromotionExposureDirective
  implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly promotion = inject(PhotoPromotionPlacementService);

  @Input({ required: true })
  appPhotoPromotionExposure = '';

  private observer: IntersectionObserver | null = null;
  private exposureTimer: ReturnType<typeof setTimeout> | null = null;
  private recorded = false;

  ngAfterViewInit(): void {
    if (
      !this.appPhotoPromotionExposure.trim()
      || typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || this.recorded) return;

        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          this.startExposureTimer();
        } else {
          this.clearExposureTimer();
        }
      },
      { threshold: [0, 0.5, 1] }
    );

    this.observer.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.clearExposureTimer();
    this.observer?.disconnect();
    this.observer = null;
  }

  private startExposureTimer(): void {
    if (this.exposureTimer || this.recorded) return;

    this.exposureTimer = setTimeout(() => {
      this.exposureTimer = null;
      this.recorded = true;
      this.observer?.disconnect();
      this.promotion
        .recordEvent$(
          this.appPhotoPromotionExposure,
          'qualified_exposure'
        )
        .subscribe();
    }, 1_000);
  }

  private clearExposureTimer(): void {
    if (!this.exposureTimer) return;
    clearTimeout(this.exposureTimer);
    this.exposureTimer = null;
  }
}
