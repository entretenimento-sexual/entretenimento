import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizePublicVideoAccessMode,
  shouldIssuePublicVideoPlaybackAccess,
} from './public-video-access-mode';

describe('public-video-access-mode', () => {
  it('mantém PREVIEW explícito sem emitir acesso ao ativo de playback', () => {
    const mode = normalizePublicVideoAccessMode('preview');

    assert.equal(mode, 'PREVIEW');
    assert.equal(shouldIssuePublicVideoPlaybackAccess(mode), false);
  });

  it('mantém PLAYBACK explícito com emissão do ativo de vídeo', () => {
    const mode = normalizePublicVideoAccessMode('PLAYBACK');

    assert.equal(mode, 'PLAYBACK');
    assert.equal(shouldIssuePublicVideoPlaybackAccess(mode), true);
  });

  it('preserva PLAYBACK como fallback para clientes legados sem mode', () => {
    for (const value of [undefined, null, '', 'unknown']) {
      const mode = normalizePublicVideoAccessMode(value);

      assert.equal(mode, 'PLAYBACK');
      assert.equal(shouldIssuePublicVideoPlaybackAccess(mode), true);
    }
  });
});
