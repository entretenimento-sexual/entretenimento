// src/app/community/profile-official-communities/profile-official-communities-error.messages.ts
// -----------------------------------------------------------------------------
// PROFILE OFFICIAL COMMUNITIES ERROR MESSAGES
// -----------------------------------------------------------------------------
// Mensagens seguras para falhas de integridade da identidade pública do perfil.
// Não expõem detalhes internos sobre UID, duplicidade de documentos ou estrutura.
// -----------------------------------------------------------------------------

export const PROFILE_OFFICIAL_COMMUNITIES_REASON_MESSAGES:
  Readonly<Record<string, string>> = Object.freeze({
    public_profile_identity_duplicate:
      'Não foi possível validar este perfil agora. Tente novamente mais tarde.',
    public_profile_identity_invalid:
      'Não foi possível validar este perfil agora. Tente novamente mais tarde.',
  });
