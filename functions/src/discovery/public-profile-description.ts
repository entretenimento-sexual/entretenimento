// functions/src/discovery/public-profile-description.ts
// -----------------------------------------------------------------------------
// DESCRIÇÃO PÚBLICA DO PERFIL
// -----------------------------------------------------------------------------
// A descrição é copiada do documento privado somente pelo backend.
// Mantém parágrafos, normaliza espaços e limita o volume publicado.
// -----------------------------------------------------------------------------

const MAX_PUBLIC_PROFILE_DESCRIPTION_LENGTH = 1000;

export function normalizePublicProfileDescription(
  value: unknown
): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_PUBLIC_PROFILE_DESCRIPTION_LENGTH);

  return normalized || null;
}
