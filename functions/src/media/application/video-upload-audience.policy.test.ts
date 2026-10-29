import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveRequiredVideoUploadAudience } from './video-upload-audience.policy';

describe('required video upload audience', () => {
  it('permite somente as audiências sociais previstas no backend', () => {
    assert.equal(resolveRequiredVideoUploadAudience('PUBLIC'), 'PUBLIC');
    assert.equal(resolveRequiredVideoUploadAudience('FRIENDS'), 'FRIENDS');
  });

  it('não publica por padrão quando o usuário não escolhe audiência', () => {
    for (const value of [undefined, null, '', 'PRIVATE', 'ONLY_ME', 'SUBSCRIBERS', 'PREMIUM', 'unknown', 'public']) {
      assert.equal(resolveRequiredVideoUploadAudience(value), null);
    }
  });
});
