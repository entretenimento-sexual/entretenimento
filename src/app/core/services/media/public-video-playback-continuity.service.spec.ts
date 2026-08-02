import { TestBed } from '@angular/core/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import {
  PUBLIC_VIDEO_METADATA_PRELOAD_CAPABILITY_READER,
  PublicVideoMetadataPreloadCapability,
} from './public-video-playback-capability';
import {
  PublicVideoPlaybackContinuityService,
  canUsePublicVideoContinuousPlayback,
  publicVideoAssetIdentity,
} from './public-video-playback-continuity.service';

const INITIAL_CAPABILITY: PublicVideoMetadataPreloadCapability = {
  documentVisible: true,
  online: true,
  saveData: false,
  effectiveType: '4g',
  downlinkMbps: 10,
};

describe('public video playback continuity policy', () => {
  it('desconsidera token e fragmento na identidade da mídia', () => {
    expect(publicVideoAssetIdentity(
      'https://cdn.example/video.mp4?token=one#frame'
    )).toBe('https://cdn.example/video.mp4');
  });

  it('permite continuidade apenas quando a capacidade permite preload', () => {
    expect(canUsePublicVideoContinuousPlayback(INITIAL_CAPABILITY)).toBe(true);
    expect(canUsePublicVideoContinuousPlayback({
      ...INITIAL_CAPABILITY,
      saveData: true,
    })).toBe(false);
  });
});

describe('PublicVideoPlaybackContinuityService', () => {
  let service: PublicVideoPlaybackContinuityService;
  let capability: PublicVideoMetadataPreloadCapability;
  let video: HTMLVideoElement;

  beforeEach(async () => {
    sessionStorage.clear();
    capability = { ...INITIAL_CAPABILITY };

    TestBed.configureTestingModule({
      providers: [
        PublicVideoPlaybackContinuityService,
        {
          provide: PUBLIC_VIDEO_METADATA_PRELOAD_CAPABILITY_READER,
          useValue: () => capability,
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(PublicVideoPlaybackContinuityService);
    service.activate();

    video = document.createElement('video');
    video.className = 'public-video-viewer__video';
    video.setAttribute(
      'src',
      'https://example.test/video-1.mp4?token=initial'
    );
    document.body.appendChild(video);
    video.dispatchEvent(new Event('loadstart', { bubbles: true }));
    await Promise.resolve();
  });

  afterEach(() => {
    video.remove();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('preserva volume e mudo ao trocar de vídeo', () => {
    video.volume = 0.35;
    video.muted = true;
    video.dispatchEvent(new Event('volumechange', { bubbles: true }));

    video.volume = 1;
    video.muted = false;
    video.setAttribute(
      'src',
      'https://example.test/video-2.mp4?token=initial'
    );
    video.dispatchEvent(new Event('loadstart', { bubbles: true }));

    expect(video.volume).toBeCloseTo(0.35);
    expect(video.muted).toBe(true);
    expect(sessionStorage.getItem('public-video-audio-preference.v1'))
      .toContain('0.35');
  });

  it('reproduz o próximo vídeo após intenção ativa', async () => {
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    video.dispatchEvent(new Event('play', { bubbles: true }));

    video.setAttribute(
      'src',
      'https://example.test/video-2.mp4?token=initial'
    );
    video.dispatchEvent(new Event('loadstart', { bubbles: true }));
    video.dispatchEvent(new Event('canplay', { bubbles: true }));
    await Promise.resolve();

    expect(play).toHaveBeenCalledTimes(1);
  });

  it('não usa autoplay quando economia de dados está ativa', async () => {
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    video.dispatchEvent(new Event('play', { bubbles: true }));
    capability = { ...capability, saveData: true };

    video.setAttribute(
      'src',
      'https://example.test/video-2.mp4?token=initial'
    );
    video.dispatchEvent(new Event('loadstart', { bubbles: true }));
    video.dispatchEvent(new Event('canplay', { bubbles: true }));
    await Promise.resolve();

    expect(play).not.toHaveBeenCalled();
    expect(video.preload).toBe('none');
  });

  it('não duplica autoplay quando somente o token é renovado', async () => {
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    video.dispatchEvent(new Event('play', { bubbles: true }));

    video.setAttribute(
      'src',
      'https://example.test/video-1.mp4?token=renewed'
    );
    video.dispatchEvent(new Event('loadstart', { bubbles: true }));
    video.dispatchEvent(new Event('canplay', { bubbles: true }));
    await Promise.resolve();

    expect(play).not.toHaveBeenCalled();
  });

  it('respeita pausa explícita antes de navegar', async () => {
    const play = vi.spyOn(video, 'play').mockResolvedValue();
    video.dispatchEvent(new Event('play', { bubbles: true }));
    video.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    video.dispatchEvent(new Event('pause', { bubbles: true }));

    video.setAttribute(
      'src',
      'https://example.test/video-2.mp4?token=initial'
    );
    video.dispatchEvent(new Event('loadstart', { bubbles: true }));
    video.dispatchEvent(new Event('canplay', { bubbles: true }));
    await Promise.resolve();

    expect(play).not.toHaveBeenCalled();
  });

  it('pausa vídeo ativo quando a página é descartada', () => {
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    Object.defineProperty(video, 'paused', {
      configurable: true,
      value: false,
    });
    video.dispatchEvent(new Event('play', { bubbles: true }));

    window.dispatchEvent(new Event('pagehide'));

    expect(pause).toHaveBeenCalledTimes(1);
  });
});
