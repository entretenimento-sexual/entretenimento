// src/app/core/utils/discovery/discovery-profile-visibility.utils.ts
// -----------------------------------------------------------------------------
// DiscoveryProfileVisibilityUtils
// -----------------------------------------------------------------------------
//
// Regra compartilhada de elegibilidade pública para discovery.
//
// Objetivo:
// - evitar que "Todos" e "Online" usem critérios diferentes;
// - impedir exposição de perfis sem identidade pública mínima;
// - manter a regra em um lugar só, facilitando evolução futura.
//
// Contrato público mínimo atual:
// - uid válido;
// - nickname público;
// - gender;
// - estado;
// - municipio.
//
// Não entram aqui:
// - email;
// - telefone;
// - acceptedTerms;
// - emailVerified;
// - profileCompleted;
// - dados privados de users/{uid}.

export type PublicDiscoveryProfileRejectionReason =
  | 'missing_profile'
  | 'missing_uid'
  | 'hidden_from_online'
  | 'missing_nickname'
  | 'missing_gender'
  | 'missing_estado'
  | 'missing_municipio'
  | null;

export interface PublicDiscoveryProfileLike {
  uid?: unknown;
  nickname?: unknown;
  gender?: unknown;
  estado?: unknown;
  municipio?: unknown;
  hideFromOnline?: unknown;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getPublicDiscoveryProfileRejectionReason(
  profile: PublicDiscoveryProfileLike | null | undefined
): PublicDiscoveryProfileRejectionReason {
  if (!profile) {
    return 'missing_profile';
  }

  if (!hasText(profile.uid)) {
    return 'missing_uid';
  }

  if (profile.hideFromOnline === true) {
    return 'hidden_from_online';
  }

  if (!hasText(profile.nickname)) {
    return 'missing_nickname';
  }

  if (!hasText(profile.gender)) {
    return 'missing_gender';
  }

  if (!hasText(profile.estado)) {
    return 'missing_estado';
  }

  if (!hasText(profile.municipio)) {
    return 'missing_municipio';
  }

  return null;
}

export function canExposePublicDiscoveryProfile(
  profile: PublicDiscoveryProfileLike | null | undefined
): boolean {
  return getPublicDiscoveryProfileRejectionReason(profile) === null;
}