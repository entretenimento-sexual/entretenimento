import { describe, expect, it } from 'vitest';

import { calculatePublicVideoQualifiedPlaybackMs } from './public-video-view-qualification.directive';

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
