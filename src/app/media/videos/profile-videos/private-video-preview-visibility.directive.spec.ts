import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PrivateVideoPreviewVisibilityDirective,
  PRIVATE_VIDEO_PREVIEW_ROOT_MARGIN,
  type PrivateVideoPreviewVisibilityChange,
} from './private-video-preview-visibility.directive';

class MockObserver implements IntersectionObserver {
  static last: MockObserver | null = null;
  readonly root = null;
  readonly rootMargin = PRIVATE_VIDEO_PREVIEW_ROOT_MARGIN;
  readonly thresholds = [0];
  private target: Element | null = null;

  constructor(private readonly callback: IntersectionObserverCallback) {
    MockObserver.last = this;
  }
  observe(target: Element): void { this.target = target; }
  unobserve(_target: Element): void { this.target = null; }
  disconnect(): void { this.target = null; }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  emit(nearby: boolean): void {
    if (!this.target) return;
    this.callback([{
      target: this.target,
      isIntersecting: nearby,
      intersectionRatio: nearby ? 1 : 0,
    } as IntersectionObserverEntry], this);
  }
}

@Component({
  standalone: true,
  imports: [PrivateVideoPreviewVisibilityDirective],
  template: `<article
    [appPrivateVideoPreviewVisibility]="videoId"
    (previewVisibilityChange)="onVisibility($event)"
  ></article>`,
})
class Host {
  videoId = 'video-1';
  readonly emissions: PrivateVideoPreviewVisibilityChange[] = [];
  onVisibility(value: PrivateVideoPreviewVisibilityChange): void {
    this.emissions.push(value);
  }
}

describe('PrivateVideoPreviewVisibilityDirective', () => {
  beforeEach(() => {
    MockObserver.last = null;
    vi.stubGlobal('IntersectionObserver', MockObserver);
    TestBed.configureTestingModule({ imports: [Host] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('autoriza somente cards próximos e desativa ao sair, sem duplicatas', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const observer = MockObserver.last;
    expect(observer).not.toBeNull();
    expect(fixture.componentInstance.emissions).toEqual([]);
    observer?.emit(true);
    observer?.emit(true);
    observer?.emit(false);
    observer?.emit(false);
    expect(fixture.componentInstance.emissions).toEqual([
      { videoId: 'video-1', nearby: true },
      { videoId: 'video-1', nearby: false },
    ]);
    fixture.destroy();
  });
  it('na ausência de IntersectionObserver mantém fallback de carregamento', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(fixture.componentInstance.emissions).toEqual([
      { videoId: 'video-1', nearby: true },
    ]);
    fixture.destroy();
  });
});
