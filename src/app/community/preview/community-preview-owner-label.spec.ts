// src/app/community/preview/community-preview-owner-label.spec.ts
import { describe, expect, it } from 'vitest';

import { CommunityPreviewPageComponent } from './community-preview-page.component';

describe('CommunityPreviewPageComponent owner label', () => {
  it('distingue proprietário, administração e moderação', () => {
    const component = Object.create(
      CommunityPreviewPageComponent.prototype
    ) as CommunityPreviewPageComponent;

    expect(component.viewerLabel('manager', 'owner')).toBe('Proprietário');
    expect(component.viewerLabel('manager', 'admin')).toBe('Administração');
    expect(component.viewerLabel('moderator', 'moderator')).toBe('Moderação');
  });
});
