import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isCommunityPreviewRuntimeAllowed,
  resolveCommunityRuntimeProjectId,
} from './community-runtime.guard';

describe('community-runtime.guard', () => {
  it('permite o Functions Emulator', () => {
    assert.equal(
      isCommunityPreviewRuntimeAllowed({
        functionsEmulator: 'true',
        gcloudProject: 'entretenimento-sexual',
      }),
      true
    );
  });

  it('permite o projeto de staging em runtime real', () => {
    assert.equal(
      isCommunityPreviewRuntimeAllowed({
        functionsEmulator: 'false',
        gcloudProject: 'entretenimento-staging',
      }),
      true
    );
  });

  it('resolve staging por GCP_PROJECT', () => {
    assert.equal(
      isCommunityPreviewRuntimeAllowed({
        functionsEmulator: 'false',
        gcpProject: 'entretenimento-staging',
      }),
      true
    );
  });

  it('resolve projectId a partir de FIREBASE_CONFIG', () => {
    const environment = {
      functionsEmulator: 'false',
      firebaseConfig: JSON.stringify({ projectId: 'entretenimento-staging' }),
    };

    assert.equal(
      resolveCommunityRuntimeProjectId(environment),
      'entretenimento-staging'
    );
    assert.equal(isCommunityPreviewRuntimeAllowed(environment), true);
  });

  it('aceita project_id legado em FIREBASE_CONFIG', () => {
    assert.equal(
      isCommunityPreviewRuntimeAllowed({
        functionsEmulator: 'false',
        firebaseConfig: JSON.stringify({
          project_id: 'entretenimento-staging',
        }),
      }),
      true
    );
  });

  it('bloqueia explicitamente produção', () => {
    assert.equal(
      isCommunityPreviewRuntimeAllowed({
        functionsEmulator: 'false',
        gcloudProject: 'entretenimento-sexual',
      }),
      false
    );
  });

  it('falha fechado para runtime desconhecido ou configuração inválida', () => {
    assert.equal(isCommunityPreviewRuntimeAllowed({}), false);
    assert.equal(
      isCommunityPreviewRuntimeAllowed({
        functionsEmulator: 'false',
        firebaseConfig: '{invalid-json',
      }),
      false
    );
  });
});
