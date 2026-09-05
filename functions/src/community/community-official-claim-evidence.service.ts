// functions/src/community/community-official-claim-evidence.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM EVIDENCE SERVICE
// -----------------------------------------------------------------------------
// Resolve e valida, dentro da mesma transação, a fonte autoritativa referenciada
// por um claim. Tipos sem fonte canônica implementada falham fechados.
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../firebaseApp';
import {
  buildOrganizationRepresentationId,
} from '../organization/organization-representation.policy';
import type {
  CommunityOfficialAuthorityRole,
  CommunityOfficialTarget,
  CommunityOfficialVerificationSource,
} from './community-official-association.model';
import type {
  CommunityOfficialClaimEvidenceReference,
  CommunityOfficialClaimEvidenceType,
} from './community-official-claim.model';
import {
  evaluateOrganizationOfficialClaimAuthority,
  evaluateVenueOfficialClaimAuthorityGrant,
  type CommunityOfficialClaimEvidenceDenialReason,
} from './community-official-claim-evidence.policy';
import {
  resolveCommunityOfficialVerificationWindow,
} from './community-official-verification-window.policy';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_REFERENCE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,320}$/;
const MAX_EVIDENCE_REFERENCES = 8;

export interface VerifiedCommunityOfficialClaimEvidence {
  readonly verificationSource: CommunityOfficialVerificationSource;
  readonly verificationPolicyVersion: number;
  readonly sponsorOrganizationId: string | null;
  readonly evidenceType: CommunityOfficialClaimEvidenceType;
  readonly revalidationDueAt: number | null;
  readonly verificationExpiresAt: number | null;
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeReferenceId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_REFERENCE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeEvidenceType(
  value: unknown
): CommunityOfficialClaimEvidenceType | null {
  return value === 'profile_kyc_record'
    || value === 'organization_kyb_record'
    || value === 'authority_record'
    || value === 'event_authorization_record'
    ? value
    : null;
}

function normalizeEvidenceReferences(
  raw: unknown
): readonly CommunityOfficialClaimEvidenceReference[] | null {
  if (
    !Array.isArray(raw)
    || raw.length < 1
    || raw.length > MAX_EVIDENCE_REFERENCES
  ) {
    return null;
  }

  const references = new Map<string, CommunityOfficialClaimEvidenceReference>();
  for (const item of raw) {
    const source = (item ?? {}) as Record<string, unknown>;
    const type = normalizeEvidenceType(source['type']);
    const referenceId = normalizeReferenceId(source['referenceId']);
    if (!type || !referenceId) return null;
    references.set(`${type}:${referenceId}`, { type, referenceId });
  }

  return references.size > 0 ? [...references.values()] : null;
}

function evidenceFailure(
  reason: CommunityOfficialClaimEvidenceDenialReason | 'unsupported_source'
): HttpsError {
  return new HttpsError(
    'failed-precondition',
    'A evidência oficial não pôde ser validada no registro de origem.',
    { reason: `official_claim_evidence_${reason}` }
  );
}

/**
 * Valida a evidência necessária para manter/promover um claim a `verified`.
 * Local e Organização possuem fontes canônicas backend-only. Profile e Event
 * permanecem fail-closed até seus resolvers próprios.
 */
export async function assertCommunityOfficialClaimEvidence(input: {
  readonly transaction: Transaction;
  readonly target: CommunityOfficialTarget;
  readonly claimantUid: string;
  readonly authorityRole: CommunityOfficialAuthorityRole;
  readonly sponsorOrganizationId: string | null;
  readonly evidenceReferences: unknown;
  readonly now: number;
}): Promise<Readonly<VerifiedCommunityOfficialClaimEvidence>> {
  const claimantUid = normalizeId(input.claimantUid);
  const references = normalizeEvidenceReferences(input.evidenceReferences);

  if (!claimantUid || !references) {
    throw evidenceFailure('unsupported_source');
  }

  if (input.target.type === 'organization') {
    const representationId = buildOrganizationRepresentationId(
      input.target.id,
      claimantUid
    );
    const kybReference = references.find(
      (reference) =>
        reference.type === 'organization_kyb_record'
        && reference.referenceId === input.target.id
    );
    const authorityReference = references.find(
      (reference) =>
        reference.type === 'authority_record'
        && reference.referenceId === representationId
    );

    if (!representationId || !kybReference || !authorityReference) {
      throw evidenceFailure('authority_reference_mismatch');
    }

    const organizationRef = db.collection('organizations').doc(input.target.id);
    const kybRef = db
      .collection('organization_kyb_records')
      .doc(kybReference.referenceId);
    const representationRef = db
      .collection('organization_representations')
      .doc(authorityReference.referenceId);
    const [organizationSnapshot, kybSnapshot, representationSnapshot] =
      await Promise.all([
        input.transaction.get(organizationRef),
        input.transaction.get(kybRef),
        input.transaction.get(representationRef),
      ]);

    const rawKyb = kybSnapshot.exists ? kybSnapshot.data() : null;
    const rawRepresentation = representationSnapshot.exists
      ? representationSnapshot.data()
      : null;
    const decision = evaluateOrganizationOfficialClaimAuthority({
      claimantUid,
      organizationId: input.target.id,
      authorityRole: input.authorityRole,
      sponsorOrganizationId: input.sponsorOrganizationId,
      kybReferenceId: kybReference.referenceId,
      authorityReferenceId: authorityReference.referenceId,
      rawOrganization: organizationSnapshot.exists
        ? organizationSnapshot.data()
        : null,
      rawKyb,
      rawRepresentation,
      now: input.now,
    });

    if (
      !decision.allowed
      || !decision.sponsorOrganizationId
      || !decision.verificationPolicyVersion
    ) {
      throw evidenceFailure(
        decision.denialReason ?? 'organization_authority_mismatch'
      );
    }

    const kyb = (rawKyb ?? {}) as Record<string, unknown>;
    const representation = (rawRepresentation ?? {}) as Record<string, unknown>;
    const window = resolveCommunityOfficialVerificationWindow({
      now: input.now,
      sourceRevalidationDueAt: kyb['revalidationDueAt'],
      sourceExpiryCandidates: [
        kyb['expiresAt'],
        representation['endsAt'],
      ],
    });

    return Object.freeze({
      verificationSource: 'organization_verification',
      verificationPolicyVersion: decision.verificationPolicyVersion,
      sponsorOrganizationId: decision.sponsorOrganizationId,
      evidenceType: kybReference.type,
      revalidationDueAt: window.revalidationDueAt,
      verificationExpiresAt: window.verificationExpiresAt,
    });
  }

  if (input.target.type !== 'venue') {
    throw evidenceFailure('unsupported_source');
  }

  const authorityReference = references.find(
    (reference) =>
      reference.type === 'authority_record'
      && reference.referenceId === claimantUid
  );
  if (!authorityReference) {
    throw evidenceFailure('authority_reference_mismatch');
  }

  const grantRef = db
    .collection('official_space_creation_grants')
    .doc(authorityReference.referenceId);
  const venueRef = db.collection('venues').doc(input.target.id);
  const [grantSnapshot, venueSnapshot] = await Promise.all([
    input.transaction.get(grantRef),
    input.transaction.get(venueRef),
  ]);
  const rawGrant = grantSnapshot.exists ? grantSnapshot.data() : null;

  const decision = evaluateVenueOfficialClaimAuthorityGrant({
    claimantUid,
    venueId: input.target.id,
    authorityRole: input.authorityRole,
    sponsorOrganizationId: input.sponsorOrganizationId,
    authorityReferenceId: authorityReference.referenceId,
    rawGrant,
    rawVenue: venueSnapshot.exists ? venueSnapshot.data() : null,
    now: input.now,
  });

  if (
    !decision.allowed
    || !decision.sponsorOrganizationId
    || !decision.verificationPolicyVersion
  ) {
    throw evidenceFailure(decision.denialReason ?? 'unsupported_source');
  }

  const grant = (rawGrant ?? {}) as Record<string, unknown>;
  const window = resolveCommunityOfficialVerificationWindow({
    now: input.now,
    sourceExpiryCandidates: [grant['endsAt']],
  });

  return Object.freeze({
    verificationSource: 'official_space_creation_grant',
    verificationPolicyVersion: decision.verificationPolicyVersion,
    sponsorOrganizationId: decision.sponsorOrganizationId,
    evidenceType: authorityReference.type,
    revalidationDueAt: window.revalidationDueAt,
    verificationExpiresAt: window.verificationExpiresAt,
  });
}
