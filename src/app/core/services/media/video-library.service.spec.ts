import { describe, expect, it } from 'vitest';

import { VideoLibraryService } from './video-library.service';

describe('VideoLibraryService date normalization', () => {
  const service = Object.create(
    VideoLibraryService.prototype
  ) as VideoLibraryService;

  const normalizeDateMs = (value: unknown): number =>
    (service as any).normalizeDateMs(value);

  const normalizeOptionalDateMs = (value: unknown): number | null =>
    (service as any).normalizeOptionalDateMs(value);

  it('preserva timestamps válidos sem depender do relógio atual', () => {
    expect(normalizeDateMs(1_700_000_000_123)).toBe(1_700_000_000_123);
    expect(normalizeDateMs({ toMillis: () => 1_700_000_000_456 })).toBe(
      1_700_000_000_456
    );
    expect(normalizeDateMs({ seconds: 1_700_000_000 })).toBe(
      1_700_000_000_000
    );
  });

  it('mantém datas ausentes ou corrompidas como desconhecidas', () => {
    expect(normalizeDateMs(undefined)).toBe(0);
    expect(normalizeDateMs('data-inválida')).toBe(0);
    expect(normalizeDateMs(new Date('invalid'))).toBe(0);
    expect(normalizeOptionalDateMs(undefined)).toBeNull();
    expect(normalizeOptionalDateMs({ toMillis: () => Number.NaN })).toBeNull();
  });
});
