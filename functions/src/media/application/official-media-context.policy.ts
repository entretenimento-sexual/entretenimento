// functions/src/media/application/official-media-context.policy.ts
// -----------------------------------------------------------------------------
// OFFICIAL MEDIA CONTEXT
// -----------------------------------------------------------------------------
// Projeção derivada para UI. Nunca é autoridade, nunca é editável pelo dono da
// mídia e nunca depende de Promotion/Boost. Cada entrada só existe enquanto:
// - a associação oficial estiver vigente;
// - o titular continuar sendo o holder canônico;
// - a autoridade real do target continuar válida em sua fonte própria.
// -----------------------------------------------------------------------------

import {
  isCanonicalResourceAuthorityRoleForTarget,
  normalizeCanonicalAuthorityResourceId,
  normalizeCanonicalResourceAuthorityRole,
  type CanonicalAuthorityTargetType,
  type CanonicalResourceAuthorityRole,
} from '../../authority/canonical-resource-authority.model';
import {
  resolveCanonicalResourceAuthority,
} from '../../authority/canonical-resource-authority.resolver';
import {
  sanitizeCommunityOfficialAssociationPublicProjection,
} from '../../community/community-official-association.model';
import {
  OFFICIAL_SPACE_CREATION_POLICY_VERSION,
  evaluateOfficialSpaceCreationGrant,
} from '../../community/community-official-space.policy';
import { evaluateProfileKyc } from '../../identity/profile-kyc.policy';

export interface OfficialMediaContextEntry {
  readonly identity: {
    readonly verified: true;
    readonly type: CanonicalAuthorityTargetType;
  };
  readonly association: {
    readonly verified: true;
  };
  readonly target: {
    readonly type: CanonicalAuthorityTargetType;
    readonly id: string;
  };
}

export interface OfficialMediaContextProjection {
  readonly contexts: readonly OfficialMediaContextEntry[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function activeAssociation(
  rawAssociation: unknown,
  nowMs: number
): {
  target: { type: CanonicalAuthorityTargetType; id: string };
  holderUid: string;
  role: CanonicalResourceAuthorityRole;
  verificationSource: string;
  verificationPolicyVersion: number;
} | null {
  const source = asRecord(rawAssociation);
  if (!source || !Number.isFinite(nowMs) || nowMs <= 0) return null;

  const projection =
    sanitizeCommunityOfficialAssociationPublicProjection(rawAssociation);
  if (!projection) return null;

  const authority = asRecord(source['authority']);
  const verification = asRecord(source['verification']);
  const holderUid = normalizeCanonicalAuthorityResourceId(
    authority?.['holderUid']
  );
  const role = normalizeCanonicalResourceAuthorityRole(authority?.['role']);
  const verificationSource = String(verification?.['source'] ?? '').trim();
  const verificationPolicyVersion = Math.trunc(
    Number(verification?.['policyVersion'])
  );

  const revalidationDueAt = source['activeRevalidationDueAt'];
  const verificationExpiresAt = source['activeVerificationExpiresAt'];
  const normalizedRevalidationDueAt =
    revalidationDueAt === null || revalidationDueAt === undefined
      ? null
      : Math.trunc(Number(revalidationDueAt));
  const normalizedVerificationExpiresAt =
    verificationExpiresAt === null || verificationExpiresAt === undefined
      ? null
      : Math.trunc(Number(verificationExpiresAt));

  if (
    !holderUid
    || !role
    || !isCanonicalResourceAuthorityRoleForTarget(projection.target.type, role)
    || !verificationSource
    || !Number.isInteger(verificationPolicyVersion)
    || verificationPolicyVersion <= 0
    || (
      normalizedRevalidationDueAt !== null
      && (
        !Number.isFinite(normalizedRevalidationDueAt)
        || normalizedRevalidationDueAt <= nowMs
      )
    )
    || (
      normalizedVerificationExpiresAt !== null
      && (
        !Number.isFinite(normalizedVerificationExpiresAt)
        || normalizedVerificationExpiresAt <= nowMs
      )
    )
  ) {
    return null;
  }

  return {
    target: projection.target,
    holderUid,
    role,
    verificationSource,
    verificationPolicyVersion,
  };
}

export function deriveOfficialMediaContextEntry(input: {
  readonly ownerUid: string;
  readonly rawAssociation: unknown;
  readonly rawUser?: unknown;
  readonly rawProfileKyc?: unknown;
  readonly rawTarget?: unknown;
  readonly rawCommercialGrant?: unknown;
  readonly rawOrganizationKyb?: unknown;
  readonly rawOrganizationRepresentation?: unknown;
  readonly rawEventAuthority?: unknown;
  readonly nowMs?: number;
}): OfficialMediaContextEntry | null {
  const ownerUid = normalizeCanonicalAuthorityResourceId(input.ownerUid);
  const nowMs = Math.trunc(input.nowMs ?? Date.now());
  const association = activeAssociation(input.rawAssociation, nowMs);

  if (!ownerUid || !association || association.holderUid !== ownerUid) {
    return null;
  }

  const { target } = association;
  let expectedVerificationSource: string;
  let expectedPolicyVersion: number | null = null;

  if (target.type === 'profile') {
    const canonicalAuthority = resolveCanonicalResourceAuthority({
      actorUid: ownerUid,
      targetType: 'profile',
      targetId: target.id,
      rawTarget: input.rawUser,
      now: nowMs,
    });
    const profileKyc = evaluateProfileKyc({
      actorUid: ownerUid,
      profileId: target.id,
      rawKyc: input.rawProfileKyc,
      now: nowMs,
    });

    if (
      !canonicalAuthority.allowed
      || canonicalAuthority.authorityUid !== ownerUid
      || canonicalAuthority.authorityRole !== 'self'
      || association.role !== 'self'
      || !profileKyc.allowed
      || !profileKyc.verificationPolicyVersion
    ) {
      return null;
    }

    expectedVerificationSource = 'profile_verification';
    expectedPolicyVersion = profileKyc.verificationPolicyVersion;
  } else if (target.type === 'organization') {
    const canonicalAuthority = resolveCanonicalResourceAuthority({
      actorUid: ownerUid,
      targetType: 'organization',
      targetId: target.id,
      rawTarget: input.rawTarget,
      rawOrganizationKyb: input.rawOrganizationKyb,
      rawOrganizationRepresentation: input.rawOrganizationRepresentation,
      requiredOrganizationScope: 'community_official_claim',
      now: nowMs,
    });

    if (
      !canonicalAuthority.allowed
      || canonicalAuthority.authorityUid !== ownerUid
      || !canonicalAuthority.authorityRole
      || !canonicalAuthority.verificationPolicyVersion
    ) {
      return null;
    }

    if (canonicalAuthority.authorityRole !== association.role) return null;
    expectedVerificationSource = 'organization_verification';
    expectedPolicyVersion = canonicalAuthority.verificationPolicyVersion;
  } else if (target.type === 'venue') {
    const grant = evaluateOfficialSpaceCreationGrant({
      actorUid: ownerUid,
      actorUserRole: null,
      rawGrant: input.rawCommercialGrant,
      now: nowMs,
    });
    const canonicalAuthority = resolveCanonicalResourceAuthority({
      actorUid: ownerUid,
      targetType: 'venue',
      targetId: target.id,
      rawTarget: input.rawTarget,
      rawCommercialGrant: input.rawCommercialGrant,
      now: nowMs,
    });

    if (
      !grant.allowed
      || !grant.organizationId
      || !canonicalAuthority.allowed
      || canonicalAuthority.authorityUid !== ownerUid
      || !canonicalAuthority.authorityRole
      || canonicalAuthority.organizationId !== grant.organizationId
    ) {
      return null;
    }

    // A associação criada para Venue pode registrar representante autorizado
    // enquanto a autoridade canônica atual é owner/manager; ambos provêm das
    // mesmas fontes backend-only e não de role comunitária.
    expectedVerificationSource = 'official_space_creation_grant';
    expectedPolicyVersion = OFFICIAL_SPACE_CREATION_POLICY_VERSION;
  } else {
    const canonicalAuthority = resolveCanonicalResourceAuthority({
      actorUid: ownerUid,
      targetType: 'event',
      targetId: target.id,
      rawTarget: null,
      rawEventAuthority: input.rawEventAuthority,
      now: nowMs,
    });

    if (
      !canonicalAuthority.allowed
      || canonicalAuthority.authorityUid !== ownerUid
      || !canonicalAuthority.authorityRole
      || !canonicalAuthority.verificationPolicyVersion
      || canonicalAuthority.authorityRole !== association.role
    ) {
      return null;
    }

    expectedVerificationSource = 'event_authorization';
    expectedPolicyVersion = canonicalAuthority.verificationPolicyVersion;
  }

  if (
    association.verificationSource !== expectedVerificationSource
    || association.verificationPolicyVersion !== expectedPolicyVersion
  ) {
    return null;
  }

  return Object.freeze({
    identity: Object.freeze({
      verified: true as const,
      type: target.type,
    }),
    association: Object.freeze({
      verified: true as const,
    }),
    target: Object.freeze({
      type: target.type,
      id: target.id,
    }),
  });
}

const TARGET_ORDER: Readonly<Record<CanonicalAuthorityTargetType, number>> =
  Object.freeze({
    profile: 0,
    organization: 1,
    venue: 2,
    event: 3,
  });

export function buildOfficialMediaContextProjection(
  entries: readonly (OfficialMediaContextEntry | null)[]
): OfficialMediaContextProjection | null {
  const unique = new Map<string, OfficialMediaContextEntry>();

  for (const entry of entries) {
    if (!entry) continue;
    unique.set(`${entry.target.type}:${entry.target.id}`, entry);
  }

  const contexts = [...unique.values()].sort((left, right) =>
    TARGET_ORDER[left.target.type] - TARGET_ORDER[right.target.type]
    || left.target.id.localeCompare(right.target.id)
  );

  return contexts.length > 0
    ? Object.freeze({ contexts: Object.freeze(contexts) })
    : null;
}

export function officialMediaContextMatches(
  raw: unknown,
  expected: OfficialMediaContextProjection | null
): boolean {
  if (!expected) {
    return raw === null || raw === undefined;
  }

  const source = asRecord(raw);
  const contexts = Array.isArray(source?.['contexts'])
    ? source?.['contexts'] as unknown[]
    : null;
  if (!contexts || contexts.length !== expected.contexts.length) return false;

  return contexts.every((rawEntry, index) => {
    const expectedEntry = expected.contexts[index];
    const entry = asRecord(rawEntry);
    const identity = asRecord(entry?.['identity']);
    const association = asRecord(entry?.['association']);
    const target = asRecord(entry?.['target']);

    return identity?.['verified'] === true
      && identity?.['type'] === expectedEntry.identity.type
      && association?.['verified'] === true
      && target?.['type'] === expectedEntry.target.type
      && target?.['id'] === expectedEntry.target.id;
  });
}
