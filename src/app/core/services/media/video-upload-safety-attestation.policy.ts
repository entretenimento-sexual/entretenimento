export const VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION =
  'video-upload-safety-v1' as const;

export interface IVideoUploadSafetyAttestationInput {
  safetyAttestationVersion:
    typeof VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION;
  allParticipantsAdultsAndConsenting: true;
  rightsAndPermissionsConfirmed: true;
  prohibitedContentAcknowledged: true;
}

export function buildVideoUploadSafetyAttestation(input: {
  allParticipantsAdultsAndConsenting: boolean;
  rightsAndPermissionsConfirmed: boolean;
  prohibitedContentAcknowledged: boolean;
}): IVideoUploadSafetyAttestationInput {
  if (
    input.allParticipantsAdultsAndConsenting !== true ||
    input.rightsAndPermissionsConfirmed !== true ||
    input.prohibitedContentAcknowledged !== true
  ) {
    throw new Error(
      'Todas as declarações de segurança são obrigatórias para publicar vídeos.'
    );
  }

  return {
    safetyAttestationVersion: VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION,
    allParticipantsAdultsAndConsenting: true,
    rightsAndPermissionsConfirmed: true,
    prohibitedContentAcknowledged: true,
  };
}
