// functions/src/community/run-community-official-association-lifecycle.schedule.ts
// -----------------------------------------------------------------------------
// RUN COMMUNITY OFFICIAL ASSOCIATION LIFECYCLE
// -----------------------------------------------------------------------------
// Revalida e expira automaticamente vínculos oficiais. O fluxo normal não cria
// fila humana: fonte canônica válida renova o selo; fonte inválida o expira.
// Falhas transitórias são relançadas para retry e nunca revogam confiança.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import {
  isCanonicalResourceAuthorityRoleForTarget,
  normalizeCanonicalAuthorityResourceId,
  normalizeCanonicalAuthorityTargetType,
  normalizeCanonicalResourceAuthorityRole,
} from '../authority/canonical-resource-authority.model';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildVerifiedCommunityOfficialAssociation,
  normalizeCommunityOfficialAssociationKey,
} from './community-official-association.model';
import { assertCommunityOfficialClaimEvidence } from './community-official-claim-evidence.service';
import {
  normalizeCommunityOfficialClaimStatus,
} from './community-official-claim.model';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const PAGE_SIZE = 50;

function cleanId(value: unknown): string | null {
  return normalizeCanonicalAuthorityResourceId(value);
}

function cleanDueEpoch(value: unknown): number | null {
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function normalizeCreatedAt(value: unknown, fallback: number): number {
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) && normalized > 0 && normalized <= fallback
    ? normalized
    : fallback;
}

function isCanonicalEvidenceDenial(error: unknown): boolean {
  return error instanceof HttpsError && error.code === 'failed-precondition';
}

async function expireAssociation(
  associationKey: string,
  now: number
): Promise<'expired' | 'skipped' | 'inconsistent'> {
  const associationRef = db
    .collection('community_official_associations')
    .doc(associationKey);
  const claimRef = db
    .collection('community_official_claims')
    .doc(associationKey);
  const auditRef = db.collection('community_official_claim_audit').doc();

  return db.runTransaction(async (transaction) => {
    const associationSnapshot = await transaction.get(associationRef);
    if (!associationSnapshot.exists) return 'skipped';

    const association = associationSnapshot.data() ?? {};
    const storedAssociationKey = normalizeCommunityOfficialAssociationKey(
      association['associationKey']
    );
    const communityId = cleanId(association['communityId']);
    const expiresAt = cleanDueEpoch(association['activeVerificationExpiresAt']);

    if (storedAssociationKey !== associationKey || !communityId) {
      return 'inconsistent';
    }
    if (
      association['status'] !== 'verified'
      || !expiresAt
      || expiresAt > now
    ) {
      return 'skipped';
    }

    const communityRef = db.collection('communities').doc(communityId);
    const [communitySnapshot, claimSnapshot] = await Promise.all([
      transaction.get(communityRef),
      transaction.get(claimRef),
    ]);

    let claimStatus: ReturnType<
      typeof normalizeCommunityOfficialClaimStatus
    > = null;
    if (claimSnapshot.exists) {
      const claim = claimSnapshot.data() ?? {};
      if (
        normalizeCommunityOfficialAssociationKey(claim['associationKey'])
          !== associationKey
        || cleanId(claim['communityId']) !== communityId
      ) {
        return 'inconsistent';
      }
      claimStatus = normalizeCommunityOfficialClaimStatus(claim['status']);
    }

    transaction.update(associationRef, {
      status: 'revoked',
      revokedAt: now,
      activeRevalidationDueAt: null,
      activeVerificationExpiresAt: null,
      updatedAt: now,
    });

    if (
      communitySnapshot.exists
      && normalizeCommunityOfficialAssociationKey(
        communitySnapshot.data()?.['officialAssociationKey']
      ) === associationKey
    ) {
      transaction.update(communityRef, {
        officialAssociationKey: FieldValue.delete(),
        updatedAt: now,
      });
    }

    if (
      claimSnapshot.exists
      && (
        claimStatus === 'verified'
        || claimStatus === 'under_review'
        || claimStatus === 'pending'
      )
    ) {
      transaction.update(claimRef, {
        status: 'expired',
        verificationExpiresAt: null,
        revalidationDueAt: null,
        revalidationRequestedAt: null,
        reviewedAt: now,
        reviewedBy: 'system',
        reviewResolution:
          'Validade da verificação oficial encerrada automaticamente.',
        updatedAt: now,
      });
    }

    transaction.create(auditRef, {
      action: 'official_claim_auto_expired',
      associationKey,
      communityId,
      previousStatus: association['status'],
      nextStatus: 'expired',
      expiresAt,
      actorUid: 'system',
      createdAt: now,
    });

    return 'expired';
  });
}

async function revalidateAssociation(
  associationKey: string,
  now: number,
  options: { readonly allowLegacyUnderReviewWithoutDue?: boolean } = {}
): Promise<'revalidated' | 'expired' | 'skipped' | 'inconsistent'> {
  const associationRef = db
    .collection('community_official_associations')
    .doc(associationKey);
  const claimRef = db
    .collection('community_official_claims')
    .doc(associationKey);
  const auditRef = db.collection('community_official_claim_audit').doc();

  return db.runTransaction(async (transaction) => {
    const [associationSnapshot, claimSnapshot] = await Promise.all([
      transaction.get(associationRef),
      transaction.get(claimRef),
    ]);
    if (!associationSnapshot.exists || !claimSnapshot.exists) {
      return 'skipped';
    }

    const association = associationSnapshot.data() ?? {};
    const claim = claimSnapshot.data() ?? {};
    const storedAssociationKey = normalizeCommunityOfficialAssociationKey(
      association['associationKey']
    );
    const claimAssociationKey = normalizeCommunityOfficialAssociationKey(
      claim['associationKey']
    );
    const communityId = cleanId(association['communityId']);
    const claimCommunityId = cleanId(claim['communityId']);
    const claimantUid = cleanId(claim['claimantUid']);
    const targetSource = (claim['target'] ?? {}) as Record<string, unknown>;
    const targetType = normalizeCanonicalAuthorityTargetType(
      targetSource['type']
    );
    const targetId = cleanId(targetSource['id']);
    const authorityRole = normalizeCanonicalResourceAuthorityRole(
      claim['authorityRole']
    );
    const sponsorOrganizationId = claim['sponsorOrganizationId'] === null
      ? null
      : cleanId(claim['sponsorOrganizationId']);
    const revalidationDueAt = cleanDueEpoch(
      association['activeRevalidationDueAt']
    );
    const expiresAt = cleanDueEpoch(
      association['activeVerificationExpiresAt']
    );
    const claimStatus = normalizeCommunityOfficialClaimStatus(claim['status']);
    const legacyUnderReview =
      options.allowLegacyUnderReviewWithoutDue === true
      && claimStatus === 'under_review'
      && revalidationDueAt === null;

    if (
      storedAssociationKey !== associationKey
      || claimAssociationKey !== associationKey
      || !communityId
      || claimCommunityId !== communityId
      || !claimantUid
      || !targetType
      || !targetId
      || !authorityRole
      || !isCanonicalResourceAuthorityRoleForTarget(targetType, authorityRole)
      || (
        claim['sponsorOrganizationId'] !== null
        && sponsorOrganizationId === null
      )
    ) {
      return 'inconsistent';
    }
    if (
      association['status'] !== 'verified'
      || (claimStatus !== 'verified' && claimStatus !== 'under_review')
      || (!legacyUnderReview && (!revalidationDueAt || revalidationDueAt > now))
      || (expiresAt !== null && expiresAt <= now)
    ) {
      return 'skipped';
    }

    const communityRef = db.collection('communities').doc(communityId);
    const communitySnapshot = await transaction.get(communityRef);
    if (!communitySnapshot.exists) return 'inconsistent';

    let verifiedEvidence: Awaited<
      ReturnType<typeof assertCommunityOfficialClaimEvidence>
    >;
    try {
      verifiedEvidence = await assertCommunityOfficialClaimEvidence({
        transaction,
        target: { type: targetType, id: targetId },
        claimantUid,
        authorityRole,
        sponsorOrganizationId,
        evidenceReferences: claim['evidenceReferences'],
        now,
      });
    } catch (error: unknown) {
      if (!isCanonicalEvidenceDenial(error)) throw error;

      transaction.update(associationRef, {
        status: 'revoked',
        revokedAt: now,
        activeRevalidationDueAt: null,
        activeVerificationExpiresAt: null,
        updatedAt: now,
      });
      if (
        normalizeCommunityOfficialAssociationKey(
          communitySnapshot.data()?.['officialAssociationKey']
        ) === associationKey
      ) {
        transaction.update(communityRef, {
          officialAssociationKey: FieldValue.delete(),
          updatedAt: now,
        });
      }
      transaction.update(claimRef, {
        status: 'expired',
        sponsorOrganizationId,
        verificationExpiresAt: null,
        revalidationDueAt: null,
        revalidationRequestedAt: null,
        reviewedAt: now,
        reviewedBy: 'system',
        reviewResolution:
          'O vínculo deixou de atender automaticamente aos requisitos da fonte canônica.',
        updatedAt: now,
      });
      transaction.create(auditRef, {
        action: 'official_claim_auto_revalidation_failed',
        associationKey,
        communityId,
        target: { type: targetType, id: targetId },
        claimantUid,
        previousStatus: claimStatus,
        nextStatus: 'expired',
        actorUid: 'system',
        createdAt: now,
      });
      return 'expired';
    }

    const refreshedAssociation = buildVerifiedCommunityOfficialAssociation({
      target: { type: targetType, id: targetId },
      communityId,
      sponsorOrganizationId: verifiedEvidence.sponsorOrganizationId,
      holderUid: claimantUid,
      authorityRole,
      verificationSource: verifiedEvidence.verificationSource,
      verifiedAt: now,
      verificationPolicyVersion: verifiedEvidence.verificationPolicyVersion,
      revalidationDueAt: verifiedEvidence.revalidationDueAt,
      verificationExpiresAt: verifiedEvidence.verificationExpiresAt,
      createdAt: normalizeCreatedAt(association['createdAt'], now),
    });
    if (!refreshedAssociation) return 'inconsistent';

    transaction.set(associationRef, refreshedAssociation);
    transaction.update(claimRef, {
      status: 'verified',
      sponsorOrganizationId: verifiedEvidence.sponsorOrganizationId,
      verificationExpiresAt: verifiedEvidence.verificationExpiresAt,
      revalidationDueAt: verifiedEvidence.revalidationDueAt,
      revalidationRequestedAt: null,
      reviewedAt: now,
      reviewedBy: 'system',
      reviewResolution: 'Vínculo oficial revalidado automaticamente.',
      updatedAt: now,
    });
    if (
      normalizeCommunityOfficialAssociationKey(
        communitySnapshot.data()?.['officialAssociationKey']
      ) !== associationKey
    ) {
      transaction.update(communityRef, {
        officialAssociationKey: associationKey,
        updatedAt: now,
      });
    }
    transaction.create(auditRef, {
      action: 'official_claim_auto_revalidated',
      associationKey,
      communityId,
      target: { type: targetType, id: targetId },
      claimantUid,
      previousStatus: claimStatus,
      nextStatus: 'verified',
      verificationSource: verifiedEvidence.verificationSource,
      verificationPolicyVersion: verifiedEvidence.verificationPolicyVersion,
      verificationExpiresAt: verifiedEvidence.verificationExpiresAt,
      revalidationDueAt: verifiedEvidence.revalidationDueAt,
      actorUid: 'system',
      createdAt: now,
    });

    return 'revalidated';
  });
}

export const runCommunityOfficialAssociationLifecycle = onSchedule(
  {
    schedule: '25 * * * *',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    maxInstances: 1,
    concurrency: 1,
  },
  async () => {
    if (!isCommunityPreviewRuntimeAvailable()) {
      logger.info('community_official_association_lifecycle_skipped_runtime');
      return;
    }

    const now = Date.now();
    const expiredSnapshot = await db
      .collection('community_official_associations')
      .where('activeVerificationExpiresAt', '<=', now)
      .limit(PAGE_SIZE)
      .get();

    let expired = 0;
    let revalidated = 0;
    let revalidationExpired = 0;
    let inconsistent = 0;

    for (const document of expiredSnapshot.docs) {
      const result = await expireAssociation(document.id, now);
      if (result === 'expired') expired += 1;
      if (result === 'inconsistent') inconsistent += 1;
    }

    const revalidationSnapshot = await db
      .collection('community_official_associations')
      .where('activeRevalidationDueAt', '<=', now)
      .limit(PAGE_SIZE)
      .get();

    for (const document of revalidationSnapshot.docs) {
      const result = await revalidateAssociation(document.id, now);
      if (result === 'revalidated') revalidated += 1;
      if (result === 'expired') revalidationExpired += 1;
      if (result === 'inconsistent') inconsistent += 1;
    }

    // Cura registros deixados em `under_review` pelo lifecycle antigo, que
    // limpava o campo de due date e passava a depender de intervenção humana.
    const legacyUnderReviewSnapshot = await db
      .collection('community_official_claims')
      .where('status', '==', 'under_review')
      .limit(PAGE_SIZE)
      .get();

    for (const document of legacyUnderReviewSnapshot.docs) {
      const associationKey = normalizeCommunityOfficialAssociationKey(
        document.data()?.['associationKey']
      );
      if (!associationKey) {
        inconsistent += 1;
        continue;
      }
      const result = await revalidateAssociation(associationKey, now, {
        allowLegacyUnderReviewWithoutDue: true,
      });
      if (result === 'revalidated') revalidated += 1;
      if (result === 'expired') revalidationExpired += 1;
      if (result === 'inconsistent') inconsistent += 1;
    }

    logger.info('community_official_association_lifecycle_completed', {
      expired,
      revalidated,
      revalidationExpired,
      inconsistent,
      expiredScanned: expiredSnapshot.size,
      revalidationScanned: revalidationSnapshot.size,
      legacyUnderReviewScanned: legacyUnderReviewSnapshot.size,
    });
  }
);
