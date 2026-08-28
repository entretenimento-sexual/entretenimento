// functions/src/community/sync-community-membership-activity.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY MEMBERSHIP ACTIVITY
// -----------------------------------------------------------------------------
// Mantém o relógio de atividade significativa sob autoridade do backend.
// Observa qualquer fluxo legítimo de membership, inclusive handlers futuros,
// sem depender de o cliente ou cada caso de uso lembrar de atualizar o lifecycle.
// Comunidades arquivadas ou agendadas para exclusão permanecem congeladas.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { canSyncCommunityActivity } from './community-activity-sync.policy';
import { isCommunityMembershipTransitionMeaningful } from './community-membership-activity.policy';

function normalizeTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }

  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof source.toMillis === 'function') {
      const time = Number(source.toMillis());
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }

    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);

    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const time = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }
  }

  return null;
}

export const syncCommunityMembershipActivity = onDocumentWritten(
  {
    document: 'communities/{communityId}/members/{uid}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const before = event.data?.before.exists
      ? event.data.before.data()
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data()
      : null;

    if (!isCommunityMembershipTransitionMeaningful(before, after)) return;

    const communityId = String(event.params['communityId'] ?? '').trim();
    if (!communityId) return;

    const communityRef = db.collection('communities').doc(communityId);
    const communitySnapshot = await communityRef.get();
    if (!communitySnapshot.exists) return;

    const community = communitySnapshot.data() ?? {};
    if (!canSyncCommunityActivity(community)) return;

    const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;
    const currentActivityAt = normalizeTimestamp(
      lifecycle['lastMeaningfulActivityAt']
    );
    const transitionAt = normalizeTimestamp(
      after?.['updatedAt'] ?? before?.['updatedAt']
    );

    if (
      currentActivityAt !== null
      && transitionAt !== null
      && currentActivityAt >= transitionAt
    ) {
      return;
    }

    const now = FieldValue.serverTimestamp();
    await communityRef.update({
      'lifecycle.lastMeaningfulActivityAt': now,
      updatedAt: now,
    });

    logger.debug('community_membership_activity_synced', {
      communityId,
    });
  }
);
