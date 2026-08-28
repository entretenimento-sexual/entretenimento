import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  shouldRequireCommunityAppCheck,
} from './community-callable-security';

describe('community-callable-security', () => {
  it('exige App Check em projeto de produção', () => {
    assert.equal(
      shouldRequireCommunityAppCheck({
        gcloudProject: 'entretenimento-sexual',
      }),
      true
    );
  });

  it('dispensa App Check no Emulator', () => {
    assert.equal(
      shouldRequireCommunityAppCheck({
        functionsEmulator: 'true',
        gcloudProject: 'entretenimento-sexual',
      }),
      false
    );
  });

  it('dispensa App Check no projeto de staging durante o rollout fechado', () => {
    assert.equal(
      shouldRequireCommunityAppCheck({
        gcloudProject: 'entretenimento-staging',
      }),
      false
    );
  });

  it('resolve o projeto pelo FIREBASE_CONFIG quando não há variável direta', () => {
    assert.equal(
      shouldRequireCommunityAppCheck({
        firebaseConfig: JSON.stringify({
          projectId: 'entretenimento-staging',
        }),
      }),
      false
    );
  });

  it('falha fechado quando o projeto não pode ser identificado', () => {
    assert.equal(shouldRequireCommunityAppCheck({}), true);
  });
});
