// src/app/community/preview/community-preview-owner-label.spec.ts
import { describe, expect, it } from 'vitest';

import { CommunityPreviewPageComponent } from './community-preview-page.component';

describe('CommunityPreviewPageComponent owner label', () => {
  it('distingue proprietário, administração e moderação', () => {
    const viewerLabel = CommunityPreviewPageComponent.prototype.viewerLabel;

    expect(viewerLabel.call(null, 'manager', 'owner')).toBe('Proprietário');
    expect(viewerLabel.call(null, 'manager', 'admin')).toBe('Administração');
    expect(viewerLabel.call(null, 'moderator', 'moderator')).toBe('Moderação');
  });
});
