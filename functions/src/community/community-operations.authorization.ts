// functions/src/community/community-operations.authorization.ts
// -----------------------------------------------------------------------------
// COMMUNITY OPERATIONS AUTHORIZATION
// -----------------------------------------------------------------------------
// Fonte canônica de autorização para diagnósticos/operações internas do domínio
// Comunidades. Permissões especializadas continuam explícitas por capability.
// Moderadores de conteúdo não recebem acesso operacional automaticamente.
// -----------------------------------------------------------------------------

export type CommunityOperationsCapability =
  | 'community:lifecycle'
  | 'community:purge'
  | 'community:ranking';

export function hasCommunityOperationsPermission(
  value: unknown,
  capability: CommunityOperationsCapability
): boolean {
  const source = normalizeRecord(value);
  const roles = new Set([
    ...normalizeStringArray(source['staffRoles']),
    ...normalizeStringArray(source['roles']),
  ]);
  const permissions = new Set(normalizeStringArray(source['permissions']));

  if (source['superadmin'] === true) roles.add('superadmin');
  if (source['admin'] === true) roles.add('admin');

  return roles.has('superadmin')
    || roles.has('admin')
    || permissions.has(capability)
    || permissions.has('community:lifecycle');
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
