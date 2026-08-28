import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CameraCaptureService } from './camera-capture.service';

describe('CameraCaptureService', () => {
  let service: CameraCaptureService;

  beforeEach(() => {
    vi.restoreAllMocks();
    TestBed.configureTestingModule({});
    service = TestBed.inject(CameraCaptureService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('abre a câmera solicitando vídeo sem áudio e prefere a câmera traseira', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(service, 'isSecureContext').mockReturnValue(true);

    await expect(firstValueFrom(service.openCamera$())).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
  });

  it('transforma o frame atual em arquivo JPEG e encerra tracks explicitamente', async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['captura'], { type: 'image/jpeg' }));
    });

    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });

    const file = await firstValueFrom(service.captureFrame$(video));
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toMatch(/^camera-\d+\.jpg$/);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 640, 480);

    const stop = vi.fn();
    service.stopStream({
      getTracks: () => [{ stop }],
    } as unknown as MediaStream);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
