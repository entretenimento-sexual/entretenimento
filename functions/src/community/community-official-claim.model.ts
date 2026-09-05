// functions/src/community/community-official-claim.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM
// -----------------------------------------------------------------------------
// Modelo privado do pedido de associação oficial.
//
// Princípios:
// - evidências são somente referências opacas a registros privados já existentes;
// - KYC/KYB, documentos, notas internas e UIDs nunca compõem projeção pública;
// - um alvo canônico possui no máximo um claim corrente, identificado pela mesma
//   associationKey usada pela associação oficial;
// - toda decisão administrativa é validada por uma máquina de estados explícita.
// -----------------------------------------------------------------------------

import {
  buildCommunityOfficialAssociationKey,
  type CommunityOfficialAuthorityRole,
  type CommunityOfficialTarget,
} from './community-official-association.model';

export const COMMUNITY_OFFICIAL_CLAIM_POLICY_VERSION = 1;

export type CommunityOfficialClaimStatus =
  | 'pending'
  | 'under_review'
  | 'verified'
  | 'rejected'
  | 'disputed'
  | 'revoked'
  | 'expired';

export type CommunityOfficialClaimEvidenceType =
  | 'profile_kyc_record'
  | 'organization_kyb_record'
  | 'authority_record'
  | 'event_authorization_record';

export type CommunityOfficialClaimReviewDecision =
  | 'approve'
  | 'reject'
  | 'mark_disputed'
  | 'request_revalidation'
  | 'revoke'
  | 'expire';

export interface CommunityOfficialClaimEvidenceReference {
  type: CommunityOfficialClaimEvidenceType;
  referenceId: string;
}

export interface CommunityOfficialClaimRecord {
  claimId: string;
  associationKey: string;
  communityId: string;
  target: CommunityOfficialTarget;
  claimantUid: string;
  authorityRole: CommunityOfficialAuthorityRole;
  sponsorOrganizationId: string | null;
  evidenceReferences: CommunityOfficialClaimEvidenceReference[];
  status: CommunityOfficialClaimStatus;
  policyVersion: number;
  submissionAttempt: number;
  submittedAt: number;
  revalidationRequestedAt: number | null;
  reviewedAt: number | null;
  reviewedBy: string | null;
  reviewResolution: string | null;
  verificationExpiresAt: number | null;
  revalidationDueAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SubmitCommunityOfficialClaimRequest {
  requestId?: unknown;
  communityId?: unknown;
  target?: unknown;
  authorityRole?: unknown;
  sponsorOrganizationId?: unknown;
  evidenceReferences?: unknown;
  declarationAccepted?: unknown;
}

export interface SubmitCommunityOfficialClaimIntentCommand {
  requestId: string;
  communityId: string;
  target: CommunityOfficialTarget;
  associationKey: string;
}

export interface SubmitCommunityOfficialClaimCommand
  extends SubmitCommunityOfficialClaimIntentCommand {
  authorityRole: CommunityOfficialAuthorityRole;
  sponsorOrganizationId: string | null;
  evidenceReferences: CommunityOfficialClaimEvidenceReference[];
}

export interface ReviewCommunityOfficialClaimRequest {
  associationKey?: unknown;
  decision?: unknown;
  resolution?: unknown;
  verificationExpiresAt?: unknown;
  revalidationDueAt?: unknown;
}

export interface ReviewCommunityOfficialClaimCommand {
  associationKey: string;
  decision: CommunityOfficialClaimReviewDecision;
  resolution: string;
  verificationExpiresAt: number | null;
  revalidationDueAt: number | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_ASSOCIATION_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,192}$/;
const MAX_EVIDENCE_REFERENCES = 8;
const MAX_VERIFICATION_WINDOW_MS = 730 * 24 * 60 * 60 * 1_000;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanAssociationKey(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ASSOCIATION_KEY_PATTERN.test(normalized) ? normalized : null;
}

function cleanTarget(value: unknown): CommunityOfficialTarget | null {
  const source = (value ?? {}) as Record<string, unknown>;
  const type = source['type'];
  const id = cleanId(source['id']);

  if (
    !id
    || (
      type !== 'profile'
      && type !== 'organization'
      && type !== 'venue'
      && type !== 'event'
    )
  ) {
    return null;
  }

  return { type, id };
}

function cleanAuthorityRole(
  value: unknown
): CommunityOfficialAuthorityRole | null {
  return value === 'self'
    || value === 'owner'
    || value === 'authorized_representative'
    || value === 'manager'
    || value === 'organizer'
    || value === 'promoter'
    ? value
    : null;
}

function roleMatchesTarget(
  target: CommunityOfficialTarget,
  role: CommunityOfficialAuthorityRole
): boolean {
  switch (target.type) {
  case 'profile':
    return role === 'self';
  case 'organization':
    return role === 'owner'
      || role === 'authorized_representative'
      || role === 'manager';
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

function cleanEvidenceType(
  value: unknown
): CommunityOfficialClaimEvidenceType | null {
  return value === 'profile_kyc_record'
    || value === 'organization_kyb_record'
    || value === 'authority_record'
    || value === 'event_authorization_record'
    ? value
    : null;
}

function cleanEvidenceReferences(
  value: unknown
): CommunityOfficialClaimEvidenceReference[] | null {
  if (!Array.isArray(value) || value.length < 1) return null;

  const unique = new Map<string, CommunityOfficialClaimEvidenceReference>();

  for (const raw of value.slice(0, MAX_EVIDENCE_REFERENCES + 1)) {
    const source = (raw ?? {}) as Record<string, unknown>;
    const type = cleanEvidenceType(source['type']);
    const referenceId = cleanId(source['referenceId']);
    if (!type || !referenceId) return null;

    unique.set(`${type}:${referenceId}`, { type, referenceId });
  }

  if (
    unique.size < 1
    || unique.size > MAX_EVIDENCE_REFERENCES
    || value.length > MAX_EVIDENCE_REFERENCES
  ) {
    return null;
  }

  return [...unique.values()];
}

function evidenceMatchesTarget(
  target: CommunityOfficialTarget,
  references: readonly CommunityOfficialClaimEvidenceReference[]
): boolean {
  if (target.type === 'profile') {
    return references.some((item) => item.type === 'profile_kyc_record');
  }

  if (target.type === 'organization') {
    return references.some((item) => item.type === 'organization_kyb_record');
  }

  if (target.type === 'venue') {
    return references.some((item) =>
      item.type === 'organization_kyb_record'
      || item.type === 'authority_record'
    );
  }

  return references.some((item) =>
    item.type === 'event_authorization_record'
    || item.type === 'authority_record'
  );
}

/**
 * Contrato seguro para o cliente: ele escolhe somente um alvo previamente
 * oferecido pela capability. Autoridade, organização patrocinadora e evidência
 * são resolvidas novamente pelo backend no momento da submissão.
 */
export function normalizeSubmitCommunityOfficialClaimIntentRequest(
  raw: unknown
): SubmitCommunityOfficialClaimIntentCommand | null {
  const source = (raw ?? {}) as SubmitCommunityOfficialClaimRequest;
  const requestId = cleanId(source.requestId);
  const communityId = cleanId(source.communityId);
  const target = cleanTarget(source.target);

  if (
    source.declarationAccepted !== true
    || !requestId
    || !communityId
    || !target
  ) {
    return null;
  }

  const associationKey = buildCommunityOfficialAssociationKey(target);
  if (!associationKey) return null;

  return { requestId, communityId, target, associationKey };
}

export function normalizeSubmitCommunityOfficialClaimRequest(
  raw: unknown
): SubmitCommunityOfficialClaimCommand | null {
  const source = (raw ?? {}) as SubmitCommunityOfficialClaimRequest;
  const intent = normalizeSubmitCommunityOfficialClaimIntentRequest(raw);
  const authorityRole = cleanAuthorityRole(source.authorityRole);
  const sponsorOrganizationId = source.sponsorOrganizationId === null
    || source.sponsorOrganizationId === undefined
    || String(source.sponsorOrganizationId).trim() === ''
    ? null
    : cleanId(source.sponsorOrganizationId);
  const evidenceReferences = cleanEvidenceReferences(source.evidenceReferences);

  if (
    !intent
    || !authorityRole
    || !roleMatchesTarget(intent.target, authorityRole)
    || !evidenceReferences
    || !evidenceMatchesTarget(intent.target, evidenceReferences)
    || (
      source.sponsorOrganizationId !== null
      && source.sponsorOrganizationId !== undefined
      && String(source.sponsorOrganizationId).trim() !== ''
      && !sponsorOrganizationId
    )
  ) {
    return null;
  }

  return {
    ...intent,
    authorityRole,
    sponsorOrganizationId,
    evidenceReferences,
  };
}

function cleanReviewDecision(
  value: unknown
): CommunityOfficialClaimReviewDecision | null {
  return value === 'approve'
    || value === 'reject'
    || value === 'mark_disputed'
    || value === 'request_revalidation'
    || value === 'revoke'
    || value === 'expire'
    ? value
    : null;
}

function cleanResolution(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
}

function cleanFutureEpoch(
  value: unknown,
  now: number
): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;

  const normalized = Math.trunc(Number(value));
  if (
    !Number.isFinite(normalized)
    || normalized <= now
    || normalized > now + MAX_VERIFICATION_WINDOW_MS
  ) {
    return undefined;
  }

  return normalized;
}

export function normalizeReviewCommunityOfficialClaimRequest(
  raw: unknown,
  now = Date.now()
): ReviewCommunityOfficialClaimCommand | null {
  const source = (raw ?? {}) as ReviewCommunityOfficialClaimRequest;
  const associationKey = cleanAssociationKey(source.associationKey);
  const decision = cleanReviewDecision(source.decision);
  const resolution = cleanResolution(source.resolution);
  const verificationExpiresAt = cleanFutureEpoch(
    source.verificationExpiresAt,
    now
  );
  const revalidationDueAt = cleanFutureEpoch(source.revalidationDueAt, now);

  if (
    !associationKey
    || !decision
    || resolution.length < 8
    || verificationExpiresAt === undefined
    || revalidationDueAt === undefined
  ) {
    return null;
  }

  if (decision === 'approve') {
    if (!verificationExpiresAt) return null;
    if (
      revalidationDueAt !== null
      && revalidationDueAt >= verificationExpiresAt
    ) {
      return null;
    }
  } else if (
    verificationExpiresAt !== null
    || revalidationDueAt !== null
  ) {
    return null;
  }

  return {
    associationKey,
    decision,
    resolution,
    verificationExpiresAt,
    revalidationDueAt,
  };
}

export function normalizeCommunityOfficialClaimStatus(
  value: unknown
): CommunityOfficialClaimStatus | null {
  return value === 'pending'
    || value === 'under_review'
    || value === 'verified'
    || value === 'rejected'
    || value === 'disputed'
    || value === 'revoked'
    || value === 'expired'
    ? value
    : null;
}

export function resolveCommunityOfficialClaimNextStatus(
  currentStatus: CommunityOfficialClaimStatus,
  decision: CommunityOfficialClaimReviewDecision
): CommunityOfficialClaimStatus | null {
  if (decision === 'approve') {
    return currentStatus === 'pending'
      || currentStatus === 'under_review'
      || currentStatus === 'rejected'
      || currentStatus === 'disputed'
      || currentStatus === 'revoked'
      || currentStatus === 'expired'
      ? 'verified'
      : null;
  }

  if (decision === 'reject') {
    return currentStatus === 'pending'
      || currentStatus === 'under_review'
      || currentStatus === 'disputed'
      ? 'rejected'
      : null;
  }

  if (decision === 'mark_disputed') {
    return currentStatus === 'pending'
      || currentStatus === 'under_review'
      || currentStatus === 'verified'
      ? 'disputed'
      : null;
  }

  if (decision === 'request_revalidation') {
    return currentStatus === 'verified' ? 'under_review' : null;
  }

  if (decision === 'revoke') {
    return currentStatus === 'verified' || currentStatus === 'under_review'
      ? 'revoked'
      : null;
  }

  if (decision === 'expire') {
    return currentStatus === 'verified' || currentStatus === 'under_review'
      ? 'expired'
      : null;
  }

  return null;
}

export function shouldRevokeAssociationForClaimDecision(
  currentStatus: CommunityOfficialClaimStatus,
  decision: CommunityOfficialClaimReviewDecision
): boolean {
  return (decision === 'mark_disputed' && currentStatus === 'verified')
    || decision === 'revoke'
    || decision === 'expire';
}
