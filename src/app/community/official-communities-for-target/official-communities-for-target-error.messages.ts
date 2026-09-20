// src/app/community/official-communities-for-target/official-communities-for-target-error.messages.ts
// -----------------------------------------------------------------------------
// OFFICIAL COMMUNITIES FOR TARGET - ERROR MESSAGES
// -----------------------------------------------------------------------------
// Catálogo da superfície transversal de associação oficial. Os reasons abaixo
// podem ser emitidos durante a validação de Perfil; Organização, Local e Evento
// usam a mesma apresentação sem criar mapas concorrentes por entidade.
// -----------------------------------------------------------------------------

export const OFFICIAL_COMMUNITIES_FOR_TARGET_REASON_MESSAGES:
  Readonly<Record<string, string>> = Object.freeze({
    public_profile_identity_duplicate:
      'Não foi possível validar esta entidade agora. Tente novamente mais tarde.',
    public_profile_identity_invalid:
      'Não foi possível validar esta entidade agora. Tente novamente mais tarde.',
  });
