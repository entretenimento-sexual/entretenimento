import { describe, expect, it } from 'vitest';

import {
  inventoryVideoProcessingOutputs,
  selectDefaultVideoProcessingVariant,
} from './video-processing-output';

describe('video-processing-output', () => {
  it('inventa variantes SD e HD do preset web-hd', () => {
    const inventory = inventoryVideoProcessingOutputs([
      {
        storagePath: 'users/u/processed/videos/v/run/sd.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1_000,
      },
      {
        storagePath: 'users/u/processed/videos/v/run/hd.mp4',
        contentType: 'video/mp4',
        sizeBytes: 3_000,
      },
      {
        storagePath: 'users/u/processed/videos/v/run/manifest.m3u8',
        contentType: 'application/vnd.apple.mpegurl',
        sizeBytes: 100,
      },
      {
        storagePath: 'users/u/processed/videos/v/run/manifest.mpd',
        contentType: 'application/dash+xml',
        sizeBytes: 100,
      },
    ]);

    expect(inventory.variants).toEqual([
      expect.objectContaining({ quality: 'SD', sizeBytes: 1_000 }),
      expect.objectContaining({ quality: 'HD', sizeBytes: 3_000 }),
    ]);
    expect(inventory.defaultQuality).toBe('HD');
    expect(inventory.hlsManifestStoragePath).toContain('manifest.m3u8');
    expect(inventory.dashManifestStoragePath).toContain('manifest.mpd');
    expect(selectDefaultVideoProcessingVariant(inventory).quality).toBe('HD');
  });

  it('mantém compatibilidade com um único MP4 legado', () => {
    const inventory = inventoryVideoProcessingOutputs([
      {
        storagePath: 'users/u/processed/videos/v/run/output.mp4',
        contentType: 'application/octet-stream',
        sizeBytes: 2_000,
      },
    ]);

    expect(inventory.variants).toEqual([
      expect.objectContaining({ quality: 'HD', mimeType: 'video/mp4' }),
    ]);
  });

  it('mantém WebM compatível no processamento do Emulator', () => {
    const inventory = inventoryVideoProcessingOutputs([
      {
        storagePath: 'users/u/processed/videos/v/run/playback.webm',
        contentType: 'video/webm',
        sizeBytes: 2_000,
      },
    ]);

    expect(inventory.variants).toEqual([
      expect.objectContaining({ quality: 'HD', mimeType: 'video/webm' }),
    ]);
  });

  it('usa menor e maior MP4 como fallback para templates sem nomes canônicos', () => {
    const inventory = inventoryVideoProcessingOutputs([
      {
        storagePath: 'users/u/processed/videos/v/run/a.mp4',
        contentType: 'video/mp4',
        sizeBytes: 900,
      },
      {
        storagePath: 'users/u/processed/videos/v/run/b.mp4',
        contentType: 'video/mp4',
        sizeBytes: 2_900,
      },
      {
        storagePath: 'users/u/processed/videos/v/run/c.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1_900,
      },
    ]);

    expect(inventory.variants.map((variant) => [
      variant.quality,
      variant.sizeBytes,
    ])).toEqual([
      ['SD', 900],
      ['HD', 2_900],
    ]);
  });

  it('falha quando não existe variante reproduzível', () => {
    expect(() => inventoryVideoProcessingOutputs([
      {
        storagePath: 'users/u/processed/videos/v/run/manifest.m3u8',
        contentType: 'application/vnd.apple.mpegurl',
        sizeBytes: 100,
      },
    ])).toThrow('variante reproduzível');
  });
});
