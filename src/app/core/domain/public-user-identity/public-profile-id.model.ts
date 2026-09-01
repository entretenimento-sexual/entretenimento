// src/app/core/domain/public-user-identity/public-profile-id.model.ts
// -----------------------------------------------------------------------------
// PUBLIC PROFILE ID - FRONTEND CONTRACT
// -----------------------------------------------------------------------------
// O frontend somente valida/transporta este identificador. Criação, reparo e
// imutabilidade pertencem ao backend.
// -----------------------------------------------------------------------------

const PUBLIC_PROFILE_ID_PATTERN =
  /^profile-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function normalizePublicProfileId(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return PUBLIC_PROFILE_ID_PATTERN.test(normalized) ? normalized : null;
}
