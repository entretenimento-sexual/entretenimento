import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoMetadataPreparationService } from './video-metadata-preparation.service';

describe('VideoMetadataPreparationService', () => {
  let service: VideoMetadataPreparationService;
  let drawImage: ReturnType<typeof vi.fn>;
  let rotate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VideoMetadataPreparationService);
    drawImage = vi.fn();
    rotate = vi.fn();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        drawImage,
        rotate,
        translate: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback, type) => {
        callback(new Blob(['poster'], { type: type || 'image/jpeg' }));
      });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('revoga ObjectURL ao concluir preparação de vídeo', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const video = originalCreateElement('video');

    Object.defineProperties(video, {
      duration: { configurable: true, value: 10 },
      videoWidth: { configurable: true, value: 1280 },
      videoHeight: { configurable: true, value: 720 },
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_CURRENT_DATA,
      },
    });

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === 'video') {
        return video;
      }
      return originalCreateElement(tagName);
    });

    vi.spyOn(video, 'load').mockImplementation(() => {
      queueMicrotask(() => {
        video.dispatchEvent(new Event('loadedmetadata'));
      });
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => 0,
      set: () => {
        queueMicrotask(() => {
          video.dispatchEvent(new Event('seeked'));
        });
      },
    });

    const createObjectURL = vi.fn(() => 'blob:video-memory-test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    const file = new File(['video'], 'memory.mp4', { type: 'video/mp4' });
    const result = await firstValueFrom(service.prepare$(file));

    expect(result.durationMs).toBe(10_000);
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-memory-test');
    expect(video.getAttribute('src')).toBeNull();
  });

  it('revoga ObjectURL também quando leitura de metadados falha', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const video = originalCreateElement('video');

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === 'video') {
        return video;
      }
      return originalCreateElement(tagName);
    });

    vi.spyOn(video, 'load').mockImplementation(() => {
      queueMicrotask(() => {
        video.dispatchEvent(new Event('error'));
      });
    });

    const createObjectURL = vi.fn(() => 'blob:video-memory-error');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    const file = new File(['video'], 'broken.mp4', { type: 'video/mp4' });
    const result = await firstValueFrom(service.prepare$(file));

    expect(result.playbackReady).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-memory-error');
    expect(video.getAttribute('src')).toBeNull();
  });

  it('gera JPEG a partir do quadro atualmente exibido', async () => {
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

  it('aplica a rotação na capa antes do enquadramento', async () => {
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
      service.captureCurrentFrame$(video, 'ORIGINAL', 90)
    );

    expect(poster.type).toBe('image/jpeg');
    expect(rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
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
  it('aborta leitura em andamento, libera src e revoga ObjectURL ao desinscrever', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const video = originalCreateElement('video');
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      return tagName.toLowerCase() === 'video' ? video : originalCreateElement(tagName);
    });
    vi.spyOn(video, 'load').mockImplementation(() => undefined);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:pending-video'),
      revokeObjectURL,
    });

    const next = vi.fn();
    const sub = service.prepare$(new File(['video'], 'old.mp4', { type: 'video/mp4' }))
      .subscribe({ next });
    expect(video.getAttribute('src')).toBe('blob:pending-video');

    sub.unsubscribe();
    await Promise.resolve();
    await Promise.resolve();

    expect(next).not.toHaveBeenCalled();
    expect(video.getAttribute('src')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pending-video');
  });

  it('descarta capa cujo canvas.toBlob terminou após fechamento do editor', async () => {
    const video = document.createElement('video');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
      readyState: {
        configurable: true,
        value: HTMLMediaElement.HAVE_CURRENT_DATA,
      },
    });

    let finishCanvas: ((blob: Blob | null) => void) | null = null;
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => { finishCanvas = callback; });

    const next = vi.fn();
    const warning = vi.fn();
    const subscription = service.captureCurrentFrame$(video)
      .subscribe({ next, error: warning });

    expect(finishCanvas).toBeTypeOf('function');
    subscription.unsubscribe();
    const callback = finishCanvas as unknown as (blob: Blob | null) => void;
    callback(new Blob(['late-poster'], { type: 'image/jpeg' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(next).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
    expect(subscription.closed).toBe(true);
  });

});
