// functions/src/organization/organization.model.ts
// -----------------------------------------------------------------------------
// CANONICAL ORGANIZATION MODEL
// -----------------------------------------------------------------------------
// Identidade operacional mínima de uma Organização. Dados de KYB, documento
// fiscal, evidências e representantes não pertencem a este projection público.
// -----------------------------------------------------------------------------

export type CanonicalOrganizationStatus = 'active' | 'inactive' | 'archived';

export interface CanonicalOrganizationRecord {
  readonly organizationId: string;
  readonly displayName: string;
  readonly status: CanonicalOrganizationStatus;
  readonly countryCode: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface OrganizationPublicProjection {
  readonly organizationId: string;
  readonly displayName: string;
  readonly countryCode: string;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

export function normalizeOrganizationId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function sanitizeOrganizationPublicProjection(
  rawOrganization: unknown,
  expectedOrganizationId?: string
): Readonly<OrganizationPublicProjection> | null {
  if (
    typeof rawOrganization !== 'object'
    || rawOrganization === null
    || Array.isArray(rawOrganization)
  ) {
    return null;
  }

  const organization = rawOrganization as Record<string, unknown>;
  const organizationId = normalizeOrganizationId(organization['organizationId']);
  const expectedId = expectedOrganizationId === undefined
    ? null
    : normalizeOrganizationId(expectedOrganizationId);
  const displayName = String(organization['displayName'] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const countryCode = String(organization['countryCode'] ?? '')
    .trim()
    .toUpperCase();

  if (
    !organizationId
    || organization['status'] !== 'active'
    || (expectedOrganizationId !== undefined && organizationId !== expectedId)
    || displayName.length < 2
    || displayName.length > 100
    || !COUNTRY_CODE_PATTERN.test(countryCode)
  ) {
    return null;
  }

  return Object.freeze({
    organizationId,
    displayName,
    countryCode,
  });
}
