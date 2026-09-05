// functions/src/community/community-official-claim-submission.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM SUBMISSION POLICY
// -----------------------------------------------------------------------------
// Converte uma intenção segura do cliente em comando privado somente quando a
// autoridade pode ser revalidada no backend. Nenhum dado de grant é confiado ao
// navegador e nenhum tipo sem fonte canônica é promovido por inferência.
// -----------------------------------------------------------------------------

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

function cleanAdminUids(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value
      .map(cleanId)
      .filter((uid): uid is string => uid !== null)
    : [];
}

function denied(
  denialReason: CommunityOfficialClaimSubmissionDenialReason
): Readonly<CommunityOfficialClaimSubmissionDecision> {
  return Object.freeze({ command: null, denialReason });
}

export function resolveCommunityOfficialClaimSubmission(input: {
  readonly actorUid: string;
  readonly intent: SubmitCommunityOfficialClaimIntentCommand;
  readonly rawGrant: unknown;
  readonly rawTarget: unknown;
  readonly now?: number;
}): Readonly<CommunityOfficialClaimSubmissionDecision> {
  const actorUid = cleanId(input.actorUid);
  if (!actorUid || input.intent.target.type !== 'venue') {
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

  const target = (input.rawTarget ?? {}) as Record<string, unknown>;
  if (target['status'] !== 'active') {
    return denied('target_inactive');
  }

  const ownerUid = cleanId(target['ownerUid']);
  const adminUids = cleanAdminUids(target['adminUids']);
  const authorityRole = ownerUid === actorUid
    ? 'owner' as const
    : adminUids.includes(actorUid)
      ? 'manager' as const
      : null;
  if (!authorityRole) {
    return denied('target_authority_mismatch');
  }

  const command: SubmitCommunityOfficialClaimCommand = {
    ...input.intent,
    authorityRole,
    sponsorOrganizationId: grant.organizationId,
    evidenceReferences: [
      { type: 'authority_record', referenceId: actorUid },
    ],
  };

  return Object.freeze({
    command,
    denialReason: null,
  });
}
