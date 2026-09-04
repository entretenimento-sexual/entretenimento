// functions/src/community/sync-community-official-association-lifecycle.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY OFFICIAL ASSOCIATION LIFECYCLE
// -----------------------------------------------------------------------------
// Revoga a associação oficial quando a Comunidade entra em estado terminal.
// A associação e sua auditoria são preservadas; somente o selo ativo deixa de
// valer. Autoridade comercial/KYC/KYB continua fora das roles comunitárias.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { db } from '../firebaseApp';
import {
  evaluateCommunityOfficialAssociationRevocation,
  resolveCommunityOfficialAssociationTerminalTransition,
} from './community-official-association-lifecycle.policy';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SYSTEM_SOURCE = 'community-terminal-lifecycle';

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function buildAuditId(eventId: unknown): string {
  const digest = createHash('sha256')
    .update(String(eventId ?? 'unknown-event'))
    .digest('hex')
    .slice(0, 40);
  return `official-revoke-${digest}`;
}

export const syncCommunityOfficialAssociationLifecycle = onDocumentWritten(
  'communities/{communityId}',
  async (event) => {
    if (!event.data?.after.exists) return;

    const communityId = normalizeSafeId(event.params.communityId);
    if (!communityId) return;

    const before = event.data.before.exists
      ? event.data.before.data() ?? null
      : null;
    const after = event.data.after.data() ?? null;
    const transition = resolveCommunityOfficialAssociationTerminalTransition(
      before,
      after
    );

    if (!transition) return;

    const now = Date.now();
    const associationRef = db
      .collection('community_official_associations')
      .doc(transition.associationKey);
    const auditRef = db
      .collection('community_official_association_audit')
      .doc(buildAuditId(event.id));

    const state = await db.runTransaction(async (transaction) => {
      const associationSnapshot = await transaction.get(associationRef);
      const decision = evaluateCommunityOfficialAssociationRevocation({
        rawAssociation: associationSnapshot.exists
          ? associationSnapshot.data() ?? null
          : null,
        expectedAssociationKey: transition.associationKey,
        expectedCommunityId: communityId,
        revokedAt: now,
      });

      if (decision.state !== 'revoke') {
        return decision.state;
      }

      transaction.update(associationRef, decision.patch);
      transaction.create(auditRef, {
        action: 'official_association_revoked',
        associationKey: transition.associationKey,
        communityId,
        target: decision.target,
        previousStatus: 'verified',
        nextStatus: 'revoked',
        reason: transition.reason,
        createdAt: now,
        source: SYSTEM_SOURCE,
      });

      return decision.state;
    });

    if (state === 'inconsistent') {
      logger.error('community_official_association_revocation_inconsistent', {
        communityId,
        associationKey: transition.associationKey,
        reason: transition.reason,
      });
      return;
    }

    if (state === 'missing') {
      logger.warn('community_official_association_revocation_missing', {
        communityId,
        associationKey: transition.associationKey,
        reason: transition.reason,
      });
      return;
    }

    logger.info('community_official_association_terminal_synced', {
      state,
      reason: transition.reason,
    });
  }
);
