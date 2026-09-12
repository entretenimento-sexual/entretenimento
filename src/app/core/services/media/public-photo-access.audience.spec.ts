import { describe, expect, it } from 'vitest';

import { isSupportedPublicPhotoAccessAudience } from './public-photo-access.service';

describe('public photo access audience', () => {
  it('hidrata somente audiências suportadas pelo backend de acesso', () => {
    expect(isSupportedPublicPhotoAccessAudience('PUBLIC')).toBe(true);
    expect(isSupportedPublicPhotoAccessAudience('FRIENDS')).toBe(true);
    expect(isSupportedPublicPhotoAccessAudience('SUBSCRIBERS')).toBe(false);
    expect(isSupportedPublicPhotoAccessAudience('PREMIUM')).toBe(false);
  });
});
