// -----------------------------------------------------------------------------
// COMMUNITY FEED REPORT ACCESS SERVICE
// -----------------------------------------------------------------------------
// Revalida conta, Comunidade e membership dentro da mesma transação que criará
// moderation_reports. Assim, mudanças concorrentes de lifecycle ou autorização
// entram no conjunto de leitura transacional e forçam retry/falha fechada.
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../firebaseApp';
import {
  assertCommunitySocialAccessEligible,
} from './community-social-access.service';
import { evaluateCommunityFeedReportAccess } from './community-feed-report-access.policy';
import type {
  CommunityFeedReportAccessDecision,
} from './community-feed-report-access.policy';

export type CommunityFeedReportTransactionalAccess = Pick<
  CommunityFeedReportAccessDecision,
  'memberContentAccess' | 'authenticatedPreviewAccess'
>;

export async function assertCommunityFeedReportAccessInTransaction(
  transaction: Transaction,
  reporterUid: string,
  communityId: string
): Promise<CommunityFeedReportTransactionalAccess> {
  const communityRef = db.collection('communities').doc(communityId);
  const membershipRef = communityRef.collection('members').doc(reporterUid);
  const userRef = db.collection('users').doc(reporterUid);
  const ageEligibilityRef = db
    .collection('age_eligibility_records')
    .doc(reporterUid);
  const [
    communitySnapshot,
    membershipSnapshot,
    userSnapshot,
    ageEligibilitySnapshot,
  ] = await Promise.all([
    transaction.get(communityRef),
    transaction.get(membershipRef),
    transaction.get(userRef),
    transaction.get(ageEligibilityRef),
  ]);

  if (!communitySnapshot.exists) {
    throw new HttpsError('not-found', 'Comunidade não encontrada.');
  }

  const user = userSnapshot.exists ? userSnapshot.data() ?? {} : null;
  assertCommunitySocialAccessEligible(
    user,
    reporterUid,
    ageEligibilitySnapshot.exists ? ageEligibilitySnapshot.data() : null
  );

  const decision = evaluateCommunityFeedReportAccess(
    communityId,
    communitySnapshot.data(),
    membershipSnapshot.exists ? membershipSnapshot.data() : null
  );

  if (!decision.allowed) {
    throw new HttpsError(
      'permission-denied',
      'Você não possui acesso a esta comunidade.'
    );
  }

  return {
    memberContentAccess: decision.memberContentAccess,
    authenticatedPreviewAccess: decision.authenticatedPreviewAccess,
  };
}
