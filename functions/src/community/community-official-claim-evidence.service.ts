// functions/src/community/community-official-claim-evidence.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM EVIDENCE SERVICE
// -----------------------------------------------------------------------------
// Resolve e valida, dentro da mesma transação da revisão, a fonte autoritativa
// referenciada por um claim. Tipos sem fonte canônica implementada falham
// fechados: revisão humana não transforma uma referência opaca em prova válida.
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../firebaseApp';
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
  evaluateVenueOfficialClaimAuthorityGrant,
  type CommunityOfficialClaimEvidenceDenialReason,
} from './community-official-claim-evidence.policy';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_EVIDENCE_REFERENCES = 8;

export interface VerifiedCommunityOfficialClaimEvidence {
  readonly verificationSource: CommunityOfficialVerificationSource;
  readonly verificationPolicyVersion: number;
  readonly sponsorOrganizationId: string | null;
  readonly evidenceType: CommunityOfficialClaimEvidenceType;
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
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
    const referenceId = normalizeId(source['referenceId']);
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
 * Valida a evidência necessária para promover um claim a `verified`.
 *
 * Atualmente o repositório possui uma única fonte autoritativa completa para
 * claims genéricos: o grant comercial de Espaço Oficial, usado para Local.
 * KYC/KYB/event authorization permanecem aceitos como referências privadas no
 * claim, mas não podem gerar selo até existir seu verificador server-side.
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

  if (input.target.type !== 'venue') {
    // Fail closed até profile KYC, organization KYB e event authorization terem
    // fontes canônicas backend-only verificáveis neste projeto.
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

  const decision = evaluateVenueOfficialClaimAuthorityGrant({
    claimantUid,
    venueId: input.target.id,
    authorityRole: input.authorityRole,
    sponsorOrganizationId: input.sponsorOrganizationId,
    authorityReferenceId: authorityReference.referenceId,
    rawGrant: grantSnapshot.exists ? grantSnapshot.data() : null,
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

  return Object.freeze({
    verificationSource: 'official_space_creation_grant',
    verificationPolicyVersion: decision.verificationPolicyVersion,
    sponsorOrganizationId: decision.sponsorOrganizationId,
    evidenceType: authorityReference.type,
  });
}
