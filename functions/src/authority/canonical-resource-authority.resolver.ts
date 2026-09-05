// functions/src/authority/canonical-resource-authority.resolver.ts
// -----------------------------------------------------------------------------
// CANONICAL RESOURCE AUTHORITY RESOLVER
// -----------------------------------------------------------------------------
// Centraliza a prova backend-only de autoridade comercial sobre recursos.
// Novos tipos só podem ser habilitados quando existir uma fonte canônica de
// autoridade para o domínio; até lá, o resolver falha fechado.
// -----------------------------------------------------------------------------

import {
  evaluateVerifiedCommercialAuthority,
} from './verified-commercial-authority.policy';

export type CanonicalAuthorityTargetType =
  | 'profile'
  | 'organization'
  | 'venue'
  | 'event';

export type CanonicalResourceAuthorityRole = 'owner' | 'manager';

export type CanonicalResourceAuthorityDenialReason =
  | 'unsupported_target'
  | 'verification_required'
  | 'verification_inactive'
  | 'target_inactive'
  | 'target_authority_mismatch';

export interface CanonicalResourceAuthorityDecision {
  readonly allowed: boolean;
  readonly targetType: CanonicalAuthorityTargetType;
  readonly targetId: string;
  readonly organizationId: string | null;
  readonly authorityUid: string | null;
  readonly authorityRole: CanonicalResourceAuthorityRole | null;
  readonly denialReason: CanonicalResourceAuthorityDenialReason | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanAdminUids(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value
      .map(cleanId)
      .filter((uid): uid is string => uid !== null)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function denied(input: {
  targetType: CanonicalAuthorityTargetType;
  targetId: string;
  organizationId?: string | null;
  authorityUid?: string | null;
  denialReason: CanonicalResourceAuthorityDenialReason;
}): Readonly<CanonicalResourceAuthorityDecision> {
  return Object.freeze({
    allowed: false,
    targetType: input.targetType,
    targetId: input.targetId,
    organizationId: input.organizationId ?? null,
    authorityUid: input.authorityUid ?? null,
    authorityRole: null,
    denialReason: input.denialReason,
  });
}

export function resolveCanonicalResourceAuthority(input: {
  readonly actorUid: string;
  readonly targetType: CanonicalAuthorityTargetType;
  readonly targetId: string;
  readonly rawCommercialGrant: unknown;
  readonly rawTarget: unknown;
  readonly now?: number;
}): Readonly<CanonicalResourceAuthorityDecision> {
  const actorUid = cleanId(input.actorUid);
  const targetId = cleanId(input.targetId) ?? '';

  if (!actorUid || !targetId) {
    return denied({
      targetType: input.targetType,
      targetId,
      denialReason: 'target_authority_mismatch',
    });
  }

  if (input.targetType !== 'venue') {
    return denied({
      targetType: input.targetType,
      targetId,
      denialReason: 'unsupported_target',
    });
  }

  const commercialAuthority = evaluateVerifiedCommercialAuthority({
    actorUid,
    rawGrant: input.rawCommercialGrant,
    now: input.now,
  });

  if (!commercialAuthority.allowed) {
    return denied({
      targetType: input.targetType,
      targetId,
      organizationId: commercialAuthority.organizationId,
      authorityUid: commercialAuthority.holderUid,
      denialReason: commercialAuthority.denialReason === 'authority_inactive'
        ? 'verification_inactive'
        : 'verification_required',
    });
  }

  if (!isRecord(input.rawTarget) || input.rawTarget['status'] !== 'active') {
    return denied({
      targetType: input.targetType,
      targetId,
      organizationId: commercialAuthority.organizationId,
      authorityUid: commercialAuthority.holderUid,
      denialReason: 'target_inactive',
    });
  }

  const ownerUid = cleanId(input.rawTarget['ownerUid']);
  const adminUids = cleanAdminUids(input.rawTarget['adminUids']);
  const authorityRole = ownerUid === actorUid
    ? 'owner' as const
    : adminUids.includes(actorUid)
      ? 'manager' as const
      : null;

  if (!authorityRole) {
    return denied({
      targetType: input.targetType,
      targetId,
      organizationId: commercialAuthority.organizationId,
      authorityUid: commercialAuthority.holderUid,
      denialReason: 'target_authority_mismatch',
    });
  }

  return Object.freeze({
    allowed: true,
    targetType: input.targetType,
    targetId,
    organizationId: commercialAuthority.organizationId,
    authorityUid: commercialAuthority.holderUid,
    authorityRole,
    denialReason: null,
  });
}
