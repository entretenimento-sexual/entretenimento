import {
  evaluatePublicVideoAccountEligibility,
  type PublicVideoAccountDenialReason,
} from './public-video-audience-access.policy';
import type { PrivateMediaDraftErrorCode } from './private-media-draft-error';

export interface PrivateMediaDraftEligibilityDecision {
  allowed: boolean;
  reason: PublicVideoAccountDenialReason | null;
  errorCode: PrivateMediaDraftErrorCode | null;
  message: string | null;
  recovery: string | null;
}

const DENIAL_MAP: Record<
  PublicVideoAccountDenialReason,
  Omit<PrivateMediaDraftEligibilityDecision, 'allowed' | 'reason'>
> = {
  profile_missing: {
    errorCode: 'MEDIA_UPLOAD_NOT_ALLOWED',
    message: 'O perfil autenticado não está disponível para envio de mídia.',
    recovery: 'Atualize a sessão e tente novamente.',
  },
  account_restricted: {
    errorCode: 'MEDIA_UPLOAD_NOT_ALLOWED',
    message: 'A conta não está liberada para enviar mídia.',
    recovery: 'Regularize a situação da conta antes de continuar.',
  },
  email_unverified: {
    errorCode: 'MEDIA_EMAIL_VERIFICATION_REQUIRED',
    message: 'Confirme o endereço de e-mail antes de enviar mídia.',
    recovery: 'Conclua a verificação do e-mail e tente novamente.',
  },
  adult_access_required: {
    errorCode: 'MEDIA_ADULT_ACCESS_REQUIRED',
    message: 'O acesso adulto precisa estar válido para enviar mídia.',
    recovery: 'Conclua ou atualize a verificação de maioridade.',
  },
  terms_required: {
    errorCode: 'MEDIA_TERMS_REQUIRED',
    message: 'Os termos vigentes precisam ser aceitos antes do envio.',
    recovery: 'Revise e aceite os termos apresentados na conta.',
  },
  profile_incomplete: {
    errorCode: 'MEDIA_PROFILE_INCOMPLETE',
    message: 'Conclua o perfil antes de enviar mídia.',
    recovery: 'Preencha os dados obrigatórios do perfil e tente novamente.',
  },
};

export function evaluatePrivateMediaDraftEligibility(
  rawUser: unknown,
  expectedUid: string,
  authenticatedEmailVerified: boolean
): PrivateMediaDraftEligibilityDecision {
  const decision = evaluatePublicVideoAccountEligibility(
    rawUser,
    expectedUid,
    {
      authenticatedEmailVerified,
      requireVerifiedEmail: true,
      requireCompletedProfile: true,
    }
  );

  if (decision.allowed || decision.reason === null) {
    return {
      allowed: true,
      reason: null,
      errorCode: null,
      message: null,
      recovery: null,
    };
  }

  return {
    allowed: false,
    reason: decision.reason,
    ...DENIAL_MAP[decision.reason],
  };
}
