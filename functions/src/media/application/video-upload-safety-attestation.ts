import { HttpsError } from 'firebase-functions/v2/https';

export const VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION =
  'video-upload-safety-v1';

export interface VideoUploadSafetyAttestationInput {
  safetyAttestationVersion?: unknown;
  allParticipantsAdultsAndConsenting?: unknown;
  rightsAndPermissionsConfirmed?: unknown;
  prohibitedContentAcknowledged?: unknown;
}

export interface VideoUploadSafetyAttestation {
  version: typeof VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION;
  allParticipantsAdultsAndConsenting: true;
  rightsAndPermissionsConfirmed: true;
  prohibitedContentAcknowledged: true;
}

export function assertVideoUploadSafetyAttestation(
  input: VideoUploadSafetyAttestationInput | null | undefined
): VideoUploadSafetyAttestation {
  const version = String(input?.safetyAttestationVersion ?? '').trim();

  if (version !== VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION) {
    throw new HttpsError(
      'failed-precondition',
      'Confirme novamente as declarações de segurança antes de enviar o vídeo.'
    );
  }

  if (
    input?.allParticipantsAdultsAndConsenting !== true ||
    input?.rightsAndPermissionsConfirmed !== true ||
    input?.prohibitedContentAcknowledged !== true
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Todas as declarações de segurança são obrigatórias para publicar vídeos.'
    );
  }

  return {
    version: VIDEO_UPLOAD_SAFETY_ATTESTATION_VERSION,
    allParticipantsAdultsAndConsenting: true,
    rightsAndPermissionsConfirmed: true,
    prohibitedContentAcknowledged: true,
  };
}
