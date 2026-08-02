import { describe, expect, it } from 'vitest';

import type {
  IPublicVideoAccessVariant,
} from 'src/app/core/interfaces/media/i-public-video-item';
import type {
  PublicVideoMetadataPreloadCapability,
} from './public-video-playback-capability';
import {
  selectPublicVideoAccessVariant,
  shouldPreferPublicVideoSd,
} from './public-video-quality.policy';

const VARIANTS: IPublicVideoAccessVariant[] = [
  {
    quality: 'SD',
    url: 'https://example.test/sd.mp4?token=sd',
    mimeType: 'video/mp4',
    sizeBytes: 1_000,
  },
  {
    quality: 'HD',
    url: 'https://example.test/hd.mp4?token=hd',
    mimeType: 'video/mp4',
    sizeBytes: 3_000,
  },
];

function capability(
  patch: Partial<PublicVideoMetadataPreloadCapability> = {}
): PublicVideoMetadataPreloadCapability {
  return {
    documentVisible: true,
    online: true,
    saveData: false,
    effectiveType: '4g',
    downlinkMbps: 10,
    ...patch,
  };
}

describe('public-video-quality.policy', () => {
  it('seleciona SD quando economia de dados está ativa', () => {
    const network = capability({ saveData: true });

    expect(shouldPreferPublicVideoSd(network)).toBe(true);
    expect(selectPublicVideoAccessVariant(VARIANTS, 'HD', network)?.quality)
      .toBe('SD');
  });

  it.each(['slow-2g', '2g', '3g'])(
    'seleciona SD em rede %s',
    (effectiveType) => {
      expect(selectPublicVideoAccessVariant(
        VARIANTS,
        'HD',
        capability({ effectiveType })
      )?.quality).toBe('SD');
    }
  );

  it('seleciona SD quando a banda medida é inferior a 3 Mbps', () => {
    expect(selectPublicVideoAccessVariant(
      VARIANTS,
      'HD',
      capability({ downlinkMbps: 2.5 })
    )?.quality).toBe('SD');
  });

  it('preserva HD em conexão adequada', () => {
    expect(selectPublicVideoAccessVariant(
      VARIANTS,
      'HD',
      capability()
    )?.quality).toBe('HD');
  });

  it('usa a única variante existente como fallback', () => {
    expect(selectPublicVideoAccessVariant(
      [VARIANTS[1]],
      'SD',
      capability({ saveData: true })
    )?.quality).toBe('HD');
  });
});
