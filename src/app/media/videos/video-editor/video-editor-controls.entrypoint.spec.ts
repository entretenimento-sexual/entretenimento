import { describe, expect, it } from 'vitest';

import { VideoSimpleEditorControlsComponent as LegacyVideoEditorControlsComponent } from '../profile-videos/video-simple-editor-controls.component';
import { VideoSimpleEditorControlsComponent } from './video-editor-controls.entrypoint';

describe('video editor canonical controls entrypoint', () => {
  it('expõe a mesma implementação visual sem criar um editor paralelo', () => {
    expect(VideoSimpleEditorControlsComponent).toBe(
      LegacyVideoEditorControlsComponent
    );
  });
});
