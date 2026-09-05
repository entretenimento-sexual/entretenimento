// functions/src/community/community-official-claim-submission.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM SUBMISSION POLICY
// -----------------------------------------------------------------------------
// Converte uma intenção segura do cliente em comando privado somente quando a
// autoridade pode ser revalidada no backend. Nenhum dado de grant é confiado ao
// navegador e nenhum tipo sem fonte canônica é promovido por inferência.
// -----------------------------------------------------------------------------

import {
  resolveCanonicalResourceAuthority,
} from '../authority/canonical-resource-authority.resolver';
import {
  evaluateOfficialSpaceCreationGrant,
} from './community-official-space.policy';
import type {
  SubmitCommunityOfficialClaimCommand,
  SubmitCommunityOfficialClaimIntentCommand,
} from './community-official-claim.model';

export type CommunityOfficialClaimSubmissionDenialReason =
  | 'unsupported_target'
  | 'verification_required'
  | 'verification_inactive'
  | 'target_inactive'
  | 'target_authority_mismatch';

export interface CommunityOfficialClaimSubmissionDecision {
  readonly command: SubmitCommunityOfficialClaimCommand | null;
  readonly denialReason: CommunityOfficialClaimSubmissionDenialReason | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function denied(
  denialReason: CommunityOfficialClaimSubmissionDenialReason
): Readonly<CommunityOfficialClaimSubmissionDecision> {
  return Object.freeze({ command: null, denialReason });
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
  if (!actorUid) {
    return denied('target_authority_mismatch');
  }

  if (input.intent.target.type === 'organization') {
    const representationReferenceId = cleanId(
      input.organizationRepresentationReferenceId
    );
    if (!representationReferenceId) {
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
      now: input.now,
    });

    if (!canonicalAuthority.allowed) {
      return denied(
        canonicalAuthority.denialReason ?? 'target_authority_mismatch'
      );
    }

    if (
      !canonicalAuthority.organizationId
      || !canonicalAuthority.authorityRole
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

    return Object.freeze({ command, denialReason: null });
  }

  if (input.intent.target.type !== 'venue') {
    return denied('unsupported_target');
  }

  const grant = evaluateOfficialSpaceCreationGrant({
    actorUid,
    actorUserRole: null,
    rawGrant: input.rawGrant,
    now: input.now,
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
    now: input.now,
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

  return Object.freeze({
    command,
    denialReason: null,
  });
}
