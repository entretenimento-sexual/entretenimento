import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  DestroyRef,
  Directive,
  ElementRef,
  PLATFORM_ID,
  inject,
  input,
  output,
} from '@angular/core';

/** Antecipação pequena para evitar placeholders enquanto a capa é assinada. */
export const PRIVATE_VIDEO_PREVIEW_ROOT_MARGIN = '320px 0px';

export interface PrivateVideoPreviewVisibilityChange {
  readonly videoId: string;
  readonly nearby: boolean;
}

/**
 * Visibilidade técnica para solicitar capas, não telemetria de impressão.
 * Sem IntersectionObserver no navegador, carrega as capas normalmente.
 */
@Directive({
  selector: '[appPrivateVideoPreviewVisibility]',
  standalone: true,
})
export class PrivateVideoPreviewVisibilityDirective implements AfterViewInit {
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private observer: IntersectionObserver | null = null;
  private previous: boolean | null = null;

  readonly videoId = input.required<string>({
    alias: 'appPrivateVideoPreviewVisibility',
  });
  readonly previewVisibilityChange =
    output<PrivateVideoPreviewVisibilityChange>();

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.observer?.disconnect();
      this.observer = null;
    });
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    if (typeof IntersectionObserver !== 'function') {
      this.emitVisibility(true);
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find(
          (candidate) => candidate.target === this.element.nativeElement
        );

        if (entry) {
          this.emitVisibility(entry.isIntersecting);
        }
      },
      { rootMargin: PRIVATE_VIDEO_PREVIEW_ROOT_MARGIN, threshold: 0 }
    );
    this.observer.observe(this.element.nativeElement);
  }

  private emitVisibility(nearby: boolean): void {
    if (this.previous === nearby) return;
    const videoId = this.videoId()?.trim();
    if (!videoId) return;

    this.previous = nearby;
    this.previewVisibilityChange.emit({ videoId, nearby });
  }
}
