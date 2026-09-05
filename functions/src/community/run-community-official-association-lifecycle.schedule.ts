// functions/src/community/run-community-official-association-lifecycle.schedule.ts
// -----------------------------------------------------------------------------
// RUN COMMUNITY OFFICIAL ASSOCIATION LIFECYCLE
// -----------------------------------------------------------------------------
// Revalidação e expiração automáticas dos vínculos oficiais criados por review.
// Campos operacionais são nullificados após uso para não reprocessar registros.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  normalizeCommunityOfficialAssociationKey,
} from './community-official-association.model';
import {
  normalizeCommunityOfficialClaimStatus,
} from './community-official-claim.model';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const PAGE_SIZE = 50;
const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanDueEpoch(value: unknown): number | null {
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
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
      && (claimStatus === 'verified' || claimStatus === 'under_review')
    ) {
      transaction.update(claimRef, {
        status: 'expired',
        verificationExpiresAt: null,
        revalidationDueAt: null,
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

async function requestRevalidation(
  associationKey: string,
  now: number
): Promise<'requested' | 'skipped' | 'inconsistent'> {
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
    const revalidationDueAt = cleanDueEpoch(
      association['activeRevalidationDueAt']
    );
    const expiresAt = cleanDueEpoch(
      association['activeVerificationExpiresAt']
    );
    const claimStatus = normalizeCommunityOfficialClaimStatus(claim['status']);

    if (
      storedAssociationKey !== associationKey
      || claimAssociationKey !== associationKey
      || !communityId
      || claimCommunityId !== communityId
    ) {
      return 'inconsistent';
    }
    if (
      association['status'] !== 'verified'
      || claimStatus !== 'verified'
      || !revalidationDueAt
      || revalidationDueAt > now
      || (expiresAt !== null && expiresAt <= now)
    ) {
      return 'skipped';
    }

    transaction.update(associationRef, {
      activeRevalidationDueAt: null,
      updatedAt: now,
    });
    transaction.update(claimRef, {
      status: 'under_review',
      revalidationRequestedAt: now,
      updatedAt: now,
    });
    transaction.create(auditRef, {
      action: 'official_claim_revalidation_due',
      associationKey,
      communityId,
      previousStatus: 'verified',
      nextStatus: 'under_review',
      revalidationDueAt,
      verificationExpiresAt: expiresAt,
      actorUid: 'system',
      createdAt: now,
    });

    return 'requested';
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

    let revalidationRequested = 0;
    for (const document of revalidationSnapshot.docs) {
      const result = await requestRevalidation(document.id, now);
      if (result === 'requested') revalidationRequested += 1;
      if (result === 'inconsistent') inconsistent += 1;
    }

    logger.info('community_official_association_lifecycle_completed', {
      expired,
      revalidationRequested,
      inconsistent,
      expiredScanned: expiredSnapshot.size,
      revalidationScanned: revalidationSnapshot.size,
    });
  }
);
