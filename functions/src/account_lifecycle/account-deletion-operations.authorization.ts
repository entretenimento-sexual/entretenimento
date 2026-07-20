// functions/src/account_lifecycle/account-deletion-operations.authorization.ts
// -----------------------------------------------------------------------------
// STRICT AUTHORIZATION FOR ACCOUNT DELETION OPERATIONS
// -----------------------------------------------------------------------------
// Moderador sem permissão explícita não acessa diagnósticos do expurgo.
// -----------------------------------------------------------------------------
export function hasAccountDeletionOperationsPermission(
  value: unknown
): boolean {
  const source = normalizeRecord(value);
  const roles = new Set([
    ...normalizeStringArray(source['staffRoles']),
    ...normalizeStringArray(source['roles']),
  ]);
  const permissions = new Set(
    normalizeStringArray(source['permissions'])
  );

  if (source['superadmin'] === true) roles.add('superadmin');
  if (source['admin'] === true) roles.add('admin');
  if (source['moderator'] === true) roles.add('moderator');

  return (
    roles.has('superadmin') ||
    roles.has('admin') ||
    permissions.has('users:delete') ||
    permissions.has('users:lifecycle')
  );
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
