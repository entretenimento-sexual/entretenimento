import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoMetadataPreparationService } from './video-metadata-preparation.service';

describe('VideoMetadataPreparationService', () => {
  let service: VideoMetadataPreparationService;
  let drawImage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VideoMetadataPreparationService);
    drawImage = vi.fn();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback, type) => {
        callback(new Blob(['poster'], { type: type || 'image/jpeg' }));
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gera JPEG a partir de todo o quadro atualmente exibido', async () => {
    const video = document.createElement('video');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_CURRENT_DATA,
      },
    });

    const poster = await firstValueFrom(
      service.captureCurrentFrame$(video)
    );

    expect(poster.type).toBe('image/jpeg');
    expect(poster.size).toBeGreaterThan(0);
    expect(drawImage).toHaveBeenCalledWith(
      video,
      0,
      0,
      1920,
      1080,
      0,
      0,
      1280,
      720
    );
  });

  it('recorta a capa no centro conforme a proporção escolhida', async () => {
    const video = document.createElement('video');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_CURRENT_DATA,
      },
    });

    await firstValueFrom(
      service.captureCurrentFrame$(video, 'SQUARE_1_1')
    );

    expect(drawImage).toHaveBeenCalledWith(
      video,
      420,
      0,
      1080,
      1080,
      0,
      0,
      1080,
      1080
    );
  });

  it('recusa captura antes de o navegador disponibilizar um quadro', async () => {
    const video = document.createElement('video');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 0 },
      videoHeight: { configurable: true, value: 0 },
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_NOTHING },
    });

    await expect(
      firstValueFrom(service.captureCurrentFrame$(video))
    ).rejects.toThrow('Aguarde o quadro do vídeo aparecer');
    expect(drawImage).not.toHaveBeenCalled();
  });
});
