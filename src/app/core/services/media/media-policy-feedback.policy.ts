import type { MediaPolicyDenyReason } from './media-policy.service';

export type MediaPolicyAction =
  | 'upload-photo'
  | 'edit-photo'
  | 'upload-video'
  | 'manage-media';

const ACTION_LABELS: Readonly<Record<MediaPolicyAction, string>> = Object.freeze({
  'upload-photo': 'enviar fotos',
  'edit-photo': 'editar fotos',
  'upload-video': 'enviar vídeos',
  'manage-media': 'alterar mídias',
});

export function resolveMediaPolicyDeniedMessage(
  reason: MediaPolicyDenyReason | undefined,
  action: MediaPolicyAction
): string {
  const actionLabel = ACTION_LABELS[action];

  switch (reason) {
    case 'NOT_AUTHENTICATED':
      return `Faça login para ${actionLabel}.`;
    case 'NOT_OWNER':
      return `Você só pode ${actionLabel} no seu próprio perfil.`;
    case 'EMAIL_UNVERIFIED':
      return `Confirme seu e-mail antes de ${actionLabel}.`;
    case 'PROFILE_INCOMPLETE':
      return `Finalize seu cadastro antes de ${actionLabel}.`;
    case 'INTERACTION_BLOCKED':
    case 'BLOCKED':
      return `Sua conta não pode ${actionLabel} no momento.`;
    case 'SUBSCRIPTION_REQUIRED':
      return `Assinatura necessária para ${actionLabel}.`;
    default:
      return `Não foi possível autorizar ${actionLabel} agora.`;
  }
}
