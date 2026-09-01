// functions/src/identity/public-profile-id.ts
// -----------------------------------------------------------------------------
// PUBLIC PROFILE ID
// -----------------------------------------------------------------------------
// Identificador público opaco e imutável do perfil. Ele é deliberadamente
// diferente do Firebase Auth UID para que superfícies públicas não precisem
// transformar o identificador interno da conta em identidade social canônica.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

const PUBLIC_PROFILE_ID_PATTERN =
  /^profile-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function normalizePublicProfileId(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return PUBLIC_PROFILE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function generatePublicProfileId(): string {
  return `profile-${randomUUID()}`;
}

export function resolveOrGeneratePublicProfileId(value: unknown): string {
  return normalizePublicProfileId(value) ?? generatePublicProfileId();
}
