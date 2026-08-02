import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION,
  assertVideoUploadSafetyAttestation,
} from './video-upload-safety-attestation';

describe('video upload safety attestation', () => {
  it('aceita a versão atual com todas as confirmações', () => {
    assert.deepEqual(
      assertVideoUploadSafetyAttestation({
        safetyAttestationVersion:
          VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION,
        allParticipantsAdultsAndConsenting: true,
        rightsAndPermissionsConfirmed: true,
        prohibitedContentAcknowledged: true,
      }),
      {
        version: VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION,
        allParticipantsAdultsAndConsenting: true,
        rightsAndPermissionsConfirmed: true,
        prohibitedContentAcknowledged: true,
      }
    );
  });

  it('rejeita versão ausente ou desatualizada', () => {
    for (const version of [undefined, '', 'video-upload-safety-v0']) {
      assert.throws(() => assertVideoUploadSafetyAttestation({
        safetyAttestationVersion: version,
        allParticipantsAdultsAndConsenting: true,
        rightsAndPermissionsConfirmed: true,
        prohibitedContentAcknowledged: true,
      }));
    }
  });

  it('rejeita qualquer confirmação ausente', () => {
    const base = {
      safetyAttestationVersion: VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION,
      allParticipantsAdultsAndConsenting: true,
      rightsAndPermissionsConfirmed: true,
      prohibitedContentAcknowledged: true,
    };

    for (const field of [
      'allParticipantsAdultsAndConsenting',
      'rightsAndPermissionsConfirmed',
      'prohibitedContentAcknowledged',
    ] as const) {
      assert.throws(() => assertVideoUploadSafetyAttestation({
        ...base,
        [field]: false,
      }));
    }
  });
});
