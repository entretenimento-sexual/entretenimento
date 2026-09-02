// src/app/community/discovery/community-discovery-visibility.directive.spec.ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMMUNITY_DISCOVERY_VISIBLE_DWELL_MS,
  COMMUNITY_DISCOVERY_VISIBLE_RATIO,
  CommunityDiscoveryVisibilityDirective,
} from './community-discovery-visibility.directive';

class MockIntersectionObserver implements IntersectionObserver {
  static latest: MockIntersectionObserver | null = null;

  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0, COMMUNITY_DISCOVERY_VISIBLE_RATIO, 1];
  private target: Element | null = null;

  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.latest = this;
  }

  observe(target: Element): void {
    this.target = target;
  }

  unobserve(): void {}

  disconnect(): void {
    this.target = null;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(ratio: number): void {
    if (!this.target) return;

    const entry = {
      target: this.target,
      isIntersecting: ratio > 0,
      intersectionRatio: ratio,
    } as IntersectionObserverEntry;
    this.callback([entry], this);
  }
}

@Component({
  standalone: true,
  imports: [CommunityDiscoveryVisibilityDirective],
  template: `
    <div
      [appCommunityDiscoveryVisibility]="communityId"
      (qualifiedExposure)="record($event)"
    ></div>
  `,
})
class HostComponent {
  communityId = 'community-1';
  readonly recorded: string[] = [];

  record(communityId: string): void {
    this.recorded.push(communityId);
  }
}

describe('CommunityDiscoveryVisibilityDirective', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockIntersectionObserver.latest = null;
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('qualifica somente após 60% visível por 1 segundo contínuo', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const observer = MockIntersectionObserver.latest;

    expect(observer).not.toBeNull();
    observer?.emit(COMMUNITY_DISCOVERY_VISIBLE_RATIO);
    vi.advanceTimersByTime(COMMUNITY_DISCOVERY_VISIBLE_DWELL_MS - 1);
    expect(fixture.componentInstance.recorded).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(fixture.componentInstance.recorded).toEqual(['community-1']);
  });

  it('cancela a qualificação quando o card deixa o limiar antes do dwell', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const observer = MockIntersectionObserver.latest;

    observer?.emit(0.8);
    vi.advanceTimersByTime(500);
    observer?.emit(0.4);
    vi.advanceTimersByTime(COMMUNITY_DISCOVERY_VISIBLE_DWELL_MS);

    expect(fixture.componentInstance.recorded).toEqual([]);
  });

  it('emite no máximo uma vez por instância do card', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const observer = MockIntersectionObserver.latest;

    observer?.emit(1);
    vi.advanceTimersByTime(COMMUNITY_DISCOVERY_VISIBLE_DWELL_MS);
    observer?.emit(1);
    vi.advanceTimersByTime(COMMUNITY_DISCOVERY_VISIBLE_DWELL_MS);

    expect(fixture.componentInstance.recorded).toEqual(['community-1']);
  });
});
