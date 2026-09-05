// functions/src/organization/organization-representation.policy.ts
// -----------------------------------------------------------------------------
// ORGANIZATION REPRESENTATION POLICY
// -----------------------------------------------------------------------------
// Representação jurídica/comercial é separada de roles comunitárias e de
// autoridade financeira. Toda delegação é temporal, revogável e possui escopo.
// -----------------------------------------------------------------------------

import { normalizeOrganizationId } from './organization.model';

export type OrganizationRepresentativeRole =
  | 'owner'
  | 'legal_representative'
  | 'manager';

export type OrganizationAuthorityScope =
  | 'manage_organization'
  | 'community_official_claim'
  | 'manage_venues'
  | 'manage_events';

export type OrganizationRepresentationDenialReason =
  | 'record_mismatch'
  | 'representation_inactive'
  | 'scope_missing';

export interface OrganizationRepresentationDecision {
  readonly allowed: boolean;
  readonly organizationId: string | null;
  readonly holderUid: string | null;
  readonly role: OrganizationRepresentativeRole | null;
  readonly denialReason: OrganizationRepresentationDenialReason | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeUid(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function asPositiveTime(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function denied(input: {
  organizationId?: string | null;
  holderUid?: string | null;
  denialReason: OrganizationRepresentationDenialReason;
}): Readonly<OrganizationRepresentationDecision> {
  return Object.freeze({
    allowed: false,
    organizationId: input.organizationId ?? null,
    holderUid: input.holderUid ?? null,
    role: null,
    denialReason: input.denialReason,
  });
}

export function evaluateOrganizationRepresentation(input: {
  readonly organizationId: string;
  readonly actorUid: string;
  readonly requiredScope: OrganizationAuthorityScope;
  readonly rawRepresentation: unknown;
  readonly now?: number;
}): Readonly<OrganizationRepresentationDecision> {
  const expectedOrganizationId = normalizeOrganizationId(input.organizationId);
  const actorUid = normalizeUid(input.actorUid);

  if (!expectedOrganizationId || !actorUid) {
    return denied({ denialReason: 'record_mismatch' });
  }

  if (
    typeof input.rawRepresentation !== 'object'
    || input.rawRepresentation === null
    || Array.isArray(input.rawRepresentation)
  ) {
    return denied({
      organizationId: expectedOrganizationId,
      holderUid: actorUid,
      denialReason: 'record_mismatch',
    });
  }

  const representation = input.rawRepresentation as Record<string, unknown>;
  const organizationId = normalizeOrganizationId(representation['organizationId']);
  const holderUid = normalizeUid(representation['holderUid']);
  if (organizationId !== expectedOrganizationId || holderUid !== actorUid) {
    return denied({
      organizationId,
      holderUid,
      denialReason: 'record_mismatch',
    });
  }

  const role = representation['role'];
  if (
    role !== 'owner'
    && role !== 'legal_representative'
    && role !== 'manager'
  ) {
    return denied({
      organizationId,
      holderUid,
      denialReason: 'record_mismatch',
    });
  }

  const scopes = Array.isArray(representation['scopes'])
    ? representation['scopes'].filter((scope): scope is string => typeof scope === 'string')
    : [];
  if (!scopes.includes(input.requiredScope)) {
    return denied({
      organizationId,
      holderUid,
      denialReason: 'scope_missing',
    });
  }

  const now = Math.trunc(input.now ?? Date.now());
  const startsAt = asPositiveTime(representation['startsAt']);
  const endsAt = representation['endsAt'] === null
    ? null
    : asPositiveTime(representation['endsAt']);
  const revokedAt = representation['revokedAt'] === null
    || representation['revokedAt'] === undefined
    ? null
    : asPositiveTime(representation['revokedAt']);

  if (
    representation['status'] !== 'active'
    || !startsAt
    || startsAt > now
    || revokedAt !== null
    || (representation['endsAt'] !== null && endsAt === null)
    || (endsAt !== null && endsAt <= now)
  ) {
    return denied({
      organizationId,
      holderUid,
      denialReason: 'representation_inactive',
    });
  }

  return Object.freeze({
    allowed: true,
    organizationId,
    holderUid,
    role,
    denialReason: null,
  });
}
