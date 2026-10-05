import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  shouldRequirePublicMediaAppCheck,
} from './public-media-callable-security';

describe('public-media-callable-security', () => {
  it('exige App Check em projeto de produção', () => {
    assert.equal(
      shouldRequirePublicMediaAppCheck({
        gcloudProject: 'entretenimento-sexual',
      }),
      true
    );
  });

  it('dispensa App Check no Emulator', () => {
    assert.equal(
      shouldRequirePublicMediaAppCheck({
        functionsEmulator: 'true',
        gcloudProject: 'entretenimento-sexual',
      }),
      false
    );
  });

  it('exige App Check também no projeto de staging', () => {
    assert.equal(
      shouldRequirePublicMediaAppCheck({
        gcloudProject: 'entretenimento-staging',
      }),
      true
    );
  });

  it('não usa projectId como bypass de App Check', () => {
    assert.equal(
      shouldRequirePublicMediaAppCheck({
        firebaseConfig: JSON.stringify({
          projectId: 'entretenimento-staging',
        }),
      }),
      true
    );
  });

  it('falha fechado quando o projeto não pode ser identificado', () => {
    assert.equal(shouldRequirePublicMediaAppCheck({}), true);
  });
});
