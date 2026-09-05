// functions/src/authority/canonical-resource-authority.model.ts
// -----------------------------------------------------------------------------
// CANONICAL RESOURCE AUTHORITY MODEL
// -----------------------------------------------------------------------------
// Contrato transversal de autoridade real sobre recursos. Domínios específicos
// continuam responsáveis pela prova (KYB/representação, grant comercial etc.).
// Este arquivo centraliza somente tipos, papéis e normalização compartilhados,
// evitando unions/regex concorrentes em Comunidades e resolvers.
// -----------------------------------------------------------------------------

export const CANONICAL_AUTHORITY_TARGET_TYPES = [
  'profile',
  'organization',
  'venue',
  'event',
] as const;

export type CanonicalAuthorityTargetType =
  typeof CANONICAL_AUTHORITY_TARGET_TYPES[number];

export const CANONICAL_RESOURCE_AUTHORITY_ROLES = [
  'self',
  'owner',
  'authorized_representative',
  'manager',
  'organizer',
  'promoter',
] as const;

export type CanonicalResourceAuthorityRole =
  typeof CANONICAL_RESOURCE_AUTHORITY_ROLES[number];

const SAFE_RESOURCE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

export function normalizeCanonicalAuthorityResourceId(
  value: unknown
): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_RESOURCE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeCanonicalAuthorityTargetType(
  value: unknown
): CanonicalAuthorityTargetType | null {
  return CANONICAL_AUTHORITY_TARGET_TYPES.includes(
    value as CanonicalAuthorityTargetType
  )
    ? value as CanonicalAuthorityTargetType
    : null;
}

export function normalizeCanonicalResourceAuthorityRole(
  value: unknown
): CanonicalResourceAuthorityRole | null {
  return CANONICAL_RESOURCE_AUTHORITY_ROLES.includes(
    value as CanonicalResourceAuthorityRole
  )
    ? value as CanonicalResourceAuthorityRole
    : null;
}

export function isCanonicalResourceAuthorityRoleForTarget(
  targetType: CanonicalAuthorityTargetType,
  role: CanonicalResourceAuthorityRole
): boolean {
  switch (targetType) {
  case 'profile':
    return role === 'self';
  case 'organization':
  case 'venue':
    return role === 'owner'
      || role === 'authorized_representative'
      || role === 'manager';
  case 'event':
    return role === 'organizer'
      || role === 'promoter'
      || role === 'authorized_representative'
      || role === 'manager';
  default:
    return false;
  }
}
