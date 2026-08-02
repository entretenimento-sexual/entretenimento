import { describe, expect, it } from 'vitest';

import {
  VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION,
  buildVideoUploadSafetyAttestation,
} from './video-upload-safety-attestation.policy';

describe('video-upload-safety-attestation.policy', () => {
  it('gera o contrato atual quando todas as declarações são verdadeiras', () => {
    expect(buildVideoUploadSafetyAttestation({
      allParticipantsAdultsAndConsenting: true,
      rightsAndPermissionsConfirmed: true,
      prohibitedContentAcknowledged: true,
    })).toEqual({
      safetyAttestationVersion: VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION,
      allParticipantsAdultsAndConsenting: true,
      rightsAndPermissionsConfirmed: true,
      prohibitedContentAcknowledged: true,
    });
  });

  it.each([
    'allParticipantsAdultsAndConsenting',
    'rightsAndPermissionsConfirmed',
    'prohibitedContentAcknowledged',
  ] as const)('rejeita quando %s não foi confirmado', (field) => {
    expect(() => buildVideoUploadSafetyAttestation({
      allParticipantsAdultsAndConsenting: true,
      rightsAndPermissionsConfirmed: true,
      prohibitedContentAcknowledged: true,
      [field]: false,
    })).toThrow(
      'Todas as declarações de segurança são obrigatórias para publicar vídeos.'
    );
  });
});
