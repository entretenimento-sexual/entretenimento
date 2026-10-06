import {
  mapMediaUploadProgress,
  normalizeMediaUploadProgress,
} from './media-upload-progress.policy';

describe('media upload progress policy', () => {
  it('normaliza progresso para inteiro entre 0 e 100', () => {
    expect(normalizeMediaUploadProgress(Number.NaN)).toBe(0);
    expect(normalizeMediaUploadProgress(-10)).toBe(0);
    expect(normalizeMediaUploadProgress(42.6)).toBe(43);
    expect(normalizeMediaUploadProgress(150)).toBe(100);
  });

  it('mapeia progresso para uma faixa de fase sem ultrapassar limites', () => {
    expect(mapMediaUploadProgress(0, 6, 86)).toBe(6);
    expect(mapMediaUploadProgress(50, 6, 86)).toBe(46);
    expect(mapMediaUploadProgress(100, 6, 86)).toBe(86);
  });
});
