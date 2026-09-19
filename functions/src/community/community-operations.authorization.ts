// functions/src/community/community-operations.authorization.ts
// -----------------------------------------------------------------------------
// COMMUNITY OPERATIONS AUTHORIZATION
// -----------------------------------------------------------------------------
// Fonte canônica de autorização para diagnósticos/operações internas do domínio
// Comunidades. Toda operação exige a capability especializada correspondente.
// Papéis amplos como admin/superadmin não concedem capabilities implicitamente.
// -----------------------------------------------------------------------------

export type CommunityOperationsCapability =
  | 'community:lifecycle'
  | 'community:purge'
  | 'community:ranking'
  | 'community:reconcile';

export function hasCommunityOperationsPermission(
  value: unknown,
  capability: CommunityOperationsCapability
): boolean {
  const source = normalizeRecord(value);
  const permissions = new Set(normalizeStringArray(source['permissions']));

  return permissions.has(capability);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
