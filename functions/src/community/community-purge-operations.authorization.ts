// functions/src/community/community-purge-operations.authorization.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE OPERATIONS AUTHORIZATION
// -----------------------------------------------------------------------------
// Diagnóstico de purge é operação administrativa. Moderador sem permissão
// explícita não recebe acesso apenas por exercer moderação de conteúdo.
// -----------------------------------------------------------------------------

export function hasCommunityPurgeOperationsPermission(value: unknown): boolean {
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
    || permissions.has('community:purge')
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
