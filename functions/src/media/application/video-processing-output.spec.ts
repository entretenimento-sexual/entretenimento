import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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

    assert.deepEqual(
      inventory.variants.map((variant) => ({
        quality: variant.quality,
        sizeBytes: variant.sizeBytes,
      })),
      [
        { quality: 'SD', sizeBytes: 1_000 },
        { quality: 'HD', sizeBytes: 3_000 },
      ]
    );
    assert.equal(inventory.defaultQuality, 'HD');
    assert.match(inventory.hlsManifestStoragePath ?? '', /manifest[.]m3u8$/);
    assert.match(inventory.dashManifestStoragePath ?? '', /manifest[.]mpd$/);
    assert.equal(selectDefaultVideoProcessingVariant(inventory).quality, 'HD');
  });

  it('mantém compatibilidade com um único MP4 legado', () => {
    const inventory = inventoryVideoProcessingOutputs([
      {
        storagePath: 'users/u/processed/videos/v/run/output.mp4',
        contentType: 'application/octet-stream',
        sizeBytes: 2_000,
      },
    ]);

    assert.equal(inventory.variants.length, 1);
    assert.equal(inventory.variants[0]?.quality, 'HD');
    assert.equal(inventory.variants[0]?.mimeType, 'video/mp4');
  });

  it('mantém WebM compatível no processamento do Emulator', () => {
    const inventory = inventoryVideoProcessingOutputs([
      {
        storagePath: 'users/u/processed/videos/v/run/playback.webm',
        contentType: 'video/webm',
        sizeBytes: 2_000,
      },
    ]);

    assert.equal(inventory.variants.length, 1);
    assert.equal(inventory.variants[0]?.quality, 'HD');
    assert.equal(inventory.variants[0]?.mimeType, 'video/webm');
  });

  it('usa menor e maior MP4 como fallback', () => {
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

    assert.deepEqual(
      inventory.variants.map((variant) => [
        variant.quality,
        variant.sizeBytes,
      ]),
      [
        ['SD', 900],
        ['HD', 2_900],
      ]
    );
  });

  it('falha quando não existe variante reproduzível', () => {
    assert.throws(
      () => inventoryVideoProcessingOutputs([
        {
          storagePath: 'users/u/processed/videos/v/run/manifest.m3u8',
          contentType: 'application/vnd.apple.mpegurl',
          sizeBytes: 100,
        },
      ]),
      /variante reproduzível/
    );
  });
});
