// functions/src/community/community-official-claim-submission.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM SUBMISSION POLICY
// -----------------------------------------------------------------------------
// Converte uma intenção segura do cliente em comando privado somente quando a
// autoridade pode ser revalidada no backend. Nenhum dado de grant é confiado ao
// navegador e nenhum tipo sem fonte canônica é promovido por inferência.
// -----------------------------------------------------------------------------

import {
  normalizeCanonicalAuthorityResourceId,
} from '../authority/canonical-resource-authority.model';
import {
  resolveCanonicalResourceAuthority,
} from '../authority/canonical-resource-authority.resolver';
import {
  buildOrganizationRepresentationId,
} from '../organization/organization-representation.policy';
import type {
  CommunityOfficialVerificationSource,
} from './community-official-association.model';
import {
  OFFICIAL_SPACE_CREATION_POLICY_VERSION,
  evaluateOfficialSpaceCreationGrant,
} from './community-official-space.policy';
import type {
  SubmitCommunityOfficialClaimCommand,
  SubmitCommunityOfficialClaimIntentCommand,
} from './community-official-claim.model';
import {
  resolveCommunityOfficialVerificationWindow,
} from './community-official-verification-window.policy';

export type CommunityOfficialClaimSubmissionDenialReason =
  | 'unsupported_target'
  | 'verification_required'
  | 'verification_inactive'
  | 'target_inactive'
  | 'target_authority_mismatch';

export interface CommunityOfficialClaimSubmissionVerification {
  readonly verificationSource: CommunityOfficialVerificationSource;
  readonly verificationPolicyVersion: number;
  readonly revalidationDueAt: number | null;
  readonly verificationExpiresAt: number | null;
}

export interface CommunityOfficialClaimSubmissionDecision {
  readonly command: SubmitCommunityOfficialClaimCommand | null;
  readonly verification: CommunityOfficialClaimSubmissionVerification | null;
  readonly denialReason: CommunityOfficialClaimSubmissionDenialReason | null;
}

const SAFE_REFERENCE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,320}$/;

function cleanId(value: unknown): string | null {
  return normalizeCanonicalAuthorityResourceId(value);
}

function cleanReferenceId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_REFERENCE_ID_PATTERN.test(normalized) ? normalized : null;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function denied(
  denialReason: CommunityOfficialClaimSubmissionDenialReason
): Readonly<CommunityOfficialClaimSubmissionDecision> {
  return Object.freeze({
    command: null,
    verification: null,
    denialReason,
  });
}

export function resolveCommunityOfficialClaimSubmission(input: {
  readonly actorUid: string;
  readonly intent: SubmitCommunityOfficialClaimIntentCommand;
  readonly rawGrant?: unknown;
  readonly rawTarget: unknown;
  readonly rawOrganizationKyb?: unknown;
  readonly rawOrganizationRepresentation?: unknown;
  readonly organizationRepresentationReferenceId?: unknown;
  readonly now?: number;
}): Readonly<CommunityOfficialClaimSubmissionDecision> {
  const actorUid = cleanId(input.actorUid);
  const now = Math.trunc(input.now ?? Date.now());
  if (!actorUid || !Number.isFinite(now) || now <= 0) {
    return denied('target_authority_mismatch');
  }

  if (input.intent.target.type === 'organization') {
    const representationReferenceId = cleanReferenceId(
      input.organizationRepresentationReferenceId
    );
    const expectedRepresentationReferenceId = buildOrganizationRepresentationId(
      input.intent.target.id,
      actorUid
    );
    if (
      !representationReferenceId
      || !expectedRepresentationReferenceId
      || representationReferenceId !== expectedRepresentationReferenceId
    ) {
      return denied('target_authority_mismatch');
    }

    const canonicalAuthority = resolveCanonicalResourceAuthority({
      actorUid,
      targetType: 'organization',
      targetId: input.intent.target.id,
      rawTarget: input.rawTarget,
      rawOrganizationKyb: input.rawOrganizationKyb,
      rawOrganizationRepresentation: input.rawOrganizationRepresentation,
      requiredOrganizationScope: 'community_official_claim',
      now,
    });

    if (!canonicalAuthority.allowed) {
      return denied(
        canonicalAuthority.denialReason ?? 'target_authority_mismatch'
      );
    }

    if (
      !canonicalAuthority.organizationId
      || !canonicalAuthority.authorityRole
      || !canonicalAuthority.verificationPolicyVersion
      || canonicalAuthority.organizationId !== input.intent.target.id
    ) {
      return denied('target_authority_mismatch');
    }

    const command: SubmitCommunityOfficialClaimCommand = {
      ...input.intent,
      authorityRole: canonicalAuthority.authorityRole,
      sponsorOrganizationId: canonicalAuthority.organizationId,
      evidenceReferences: [
        {
          type: 'organization_kyb_record',
          referenceId: canonicalAuthority.organizationId,
        },
        {
          type: 'authority_record',
          referenceId: representationReferenceId,
        },
      ],
    };
    const rawKyb = asRecord(input.rawOrganizationKyb);
    const rawRepresentation = asRecord(input.rawOrganizationRepresentation);
    const window = resolveCommunityOfficialVerificationWindow({
      now,
      sourceRevalidationDueAt: rawKyb['revalidationDueAt'],
      sourceExpiryCandidates: [
        rawKyb['expiresAt'],
        rawRepresentation['endsAt'],
      ],
    });

    return Object.freeze({
      command,
      verification: Object.freeze({
        verificationSource: 'organization_verification',
        verificationPolicyVersion:
          canonicalAuthority.verificationPolicyVersion,
        revalidationDueAt: window.revalidationDueAt,
        verificationExpiresAt: window.verificationExpiresAt,
      }),
      denialReason: null,
    });
  }

  if (input.intent.target.type !== 'venue') {
    return denied('unsupported_target');
  }

  const grant = evaluateOfficialSpaceCreationGrant({
    actorUid,
    actorUserRole: null,
    rawGrant: input.rawGrant,
    now,
  });
  if (!grant.allowed || !grant.organizationId) {
    return denied(
      grant.denialReason === 'grant_inactive'
        ? 'verification_inactive'
        : 'verification_required'
    );
  }

  const canonicalAuthority = resolveCanonicalResourceAuthority({
    actorUid,
    targetType: input.intent.target.type,
    targetId: input.intent.target.id,
    rawCommercialGrant: input.rawGrant,
    rawTarget: input.rawTarget,
    now,
  });

  if (!canonicalAuthority.allowed) {
    return denied(canonicalAuthority.denialReason ?? 'target_authority_mismatch');
  }

  if (
    !canonicalAuthority.organizationId
    || !canonicalAuthority.authorityRole
  ) {
    return denied('target_authority_mismatch');
  }

  const command: SubmitCommunityOfficialClaimCommand = {
    ...input.intent,
    authorityRole: canonicalAuthority.authorityRole,
    sponsorOrganizationId: canonicalAuthority.organizationId,
    evidenceReferences: [
      { type: 'authority_record', referenceId: actorUid },
    ],
  };
  const rawGrant = asRecord(input.rawGrant);
  const window = resolveCommunityOfficialVerificationWindow({
    now,
    sourceExpiryCandidates: [rawGrant['endsAt']],
  });

  return Object.freeze({
    command,
    verification: Object.freeze({
      verificationSource: 'official_space_creation_grant',
      verificationPolicyVersion: OFFICIAL_SPACE_CREATION_POLICY_VERSION,
      revalidationDueAt: window.revalidationDueAt,
      verificationExpiresAt: window.verificationExpiresAt,
    }),
    denialReason: null,
  });
}
