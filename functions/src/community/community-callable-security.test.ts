import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  shouldRequireCommunityAppCheck,
} from './community-callable-security';

describe('community-callable-security', () => {
  it('exige App Check em qualquer runtime real', () => {
    assert.equal(
      shouldRequireCommunityAppCheck({
        functionsEmulator: 'false',
      }),
      true
    );
  });

  it('dispensa App Check somente no Emulator', () => {
    assert.equal(
      shouldRequireCommunityAppCheck({
        functionsEmulator: 'true',
      }),
      false
    );
  });

  it('exige App Check em staging', () => {
    assert.equal(shouldRequireCommunityAppCheck({}), true);
  });

  it('falha fechado quando o runtime não pode ser identificado', () => {
    assert.equal(shouldRequireCommunityAppCheck({}), true);
  });
});
