import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoViewTrackingService } from 'src/app/core/services/media/video-view-tracking.service';
import {
  PublicVideoViewQualificationDirective,
  calculatePublicVideoQualifiedPlaybackMs,
  parsePublicVideoViewIdentity,
  resolvePublicVideoRetentionMilestoneBasisPoints,
} from './public-video-view-qualification.directive';

@Component({
  standalone: true,
  imports: [PublicVideoViewQualificationDirective],
  template: '<video class="public-video-viewer__video"></video>',
})
class PublicVideoViewQualificationHostComponent {}

describe('calculatePublicVideoQualifiedPlaybackMs', () => {
  it('usa parte suficiente de vídeos curtos sem exigir duração impossível', () => {
    expect(calculatePublicVideoQualifiedPlaybackMs(2_000)).toBe(1_600);
    expect(calculatePublicVideoQualifiedPlaybackMs(10_000)).toBe(3_000);
  });

  it('cresce proporcionalmente e limita vídeos longos a dez segundos', () => {
    expect(calculatePublicVideoQualifiedPlaybackMs(30_000)).toBe(7_500);
    expect(calculatePublicVideoQualifiedPlaybackMs(120_000)).toBe(10_000);
  });
});

describe('resolvePublicVideoRetentionMilestoneBasisPoints', () => {
  it('não emite antes de cinquenta por cento', () => {
    expect(resolvePublicVideoRetentionMilestoneBasisPoints(4_999, 10_000, 0))
      .toBeNull();
  });

  it('avança apenas por marcos crescentes', () => {
    expect(resolvePublicVideoRetentionMilestoneBasisPoints(5_000, 10_000, 0))
      .toBe(5_000);
    expect(resolvePublicVideoRetentionMilestoneBasisPoints(8_000, 10_000, 5_000))
      .toBe(7_500);
    expect(resolvePublicVideoRetentionMilestoneBasisPoints(9_600, 10_000, 7_500))
      .toBe(9_000);
    expect(resolvePublicVideoRetentionMilestoneBasisPoints(10_000, 10_000, 9_000))
      .toBe(10_000);
  });

  it('não repete marco e rejeita progresso inválido', () => {
    expect(resolvePublicVideoRetentionMilestoneBasisPoints(9_100, 10_000, 9_000))
      .toBeNull();
    expect(resolvePublicVideoRetentionMilestoneBasisPoints(0, 10_000, 0))
      .toBeNull();
  });
});

describe('parsePublicVideoViewIdentity', () => {
  it('preserva custom uid com dois-pontos usando o último separador', () => {
    expect(parsePublicVideoViewIdentity('tenant:viewer:video123')).toEqual({
      ownerUid: 'tenant:viewer',
      videoId: 'video123',
    });
  });

  it('rejeita identidade sem owner ou sem videoId', () => {
    expect(parsePublicVideoViewIdentity(':video123')).toBeNull();
    expect(parsePublicVideoViewIdentity('owner:')).toBeNull();
    expect(parsePublicVideoViewIdentity('owner')).toBeNull();
  });
});

describe('PublicVideoViewQualificationDirective', () => {
  const videoViewTracking = {
    prepareVideoViewSession$: vi.fn(() => of(void 0)),
    recordVideoRetention$: vi.fn(() => of(true)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [PublicVideoViewQualificationHostComponent],
      providers: [
        { provide: VideoViewTrackingService, useValue: videoViewTracking },
      ],
    }).compileComponents();
  });

  it('registra retenção quando o evento final também qualifica a reprodução', () => {
    const fixture = TestBed.createComponent(
      PublicVideoViewQualificationHostComponent
    );
    fixture.detectChanges();

    const directiveDebugElement = fixture.debugElement.query(
      By.directive(PublicVideoViewQualificationDirective)
    );
    const directive = directiveDebugElement.injector.get(
      PublicVideoViewQualificationDirective
    );
    const video = directiveDebugElement.nativeElement as HTMLVideoElement;

    Object.defineProperty(video, 'duration', {
      configurable: true,
      value: 2,
    });
    directive.resetForVideo('owner-1:video-1');

    const runtime = directive as unknown as {
      mediaPlaybackMs: number;
      activeWallMs: number;
      activeStartedAt: number | null;
    };
    runtime.mediaPlaybackMs = 2_000;
    runtime.activeWallMs = 2_000;
    runtime.activeStartedAt = null;

    video.dispatchEvent(new Event('ended'));

    expect(videoViewTracking.recordVideoRetention$).toHaveBeenCalledTimes(1);
    expect(videoViewTracking.recordVideoRetention$).toHaveBeenCalledWith(
      'owner-1',
      'video-1',
      expect.objectContaining({
        playbackMs: 2_000,
        durationMs: 2_000,
      })
    );

    fixture.destroy();
  });
});
