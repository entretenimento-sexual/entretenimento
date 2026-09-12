// functions/src/community/sync-community-membership-activity.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY MEMBERSHIP ACTIVITY
// -----------------------------------------------------------------------------
// Mantém o relógio de atividade significativa sob autoridade do backend.
// Também converge projeções privadas descartáveis quando a participação deixa
// de estar ativa. Histórico de notificações, auditoria e estado idempotente não
// são apagados.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { canSyncCommunityActivity } from './community-activity-sync.policy';
import { isCommunityMembershipTransitionMeaningful } from './community-membership-activity.policy';
import { normalizeCommunityNotificationTimestampMs } from './community-notification.policy';

function normalizeTimestamp(value: unknown): number | null {
  return normalizeCommunityNotificationTimestampMs(value);
}

function normalizeMembershipStatus(raw: FirebaseFirestore.DocumentData | null): string {
  return String(raw?.['status'] ?? '').trim().toLowerCase();
}

function membershipCycleChanged(
  before: FirebaseFirestore.DocumentData | null,
  after: FirebaseFirestore.DocumentData | null
): boolean {
  if (normalizeMembershipStatus(after) !== 'active') return false;

  const beforeJoinedAt = normalizeTimestamp(before?.['joinedAt']);
  const afterJoinedAt = normalizeTimestamp(after?.['joinedAt']);
  return beforeJoinedAt !== afterJoinedAt;
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

    const communityId = String(event.params['communityId'] ?? '').trim();
    const uid = String(event.params['uid'] ?? '').trim();
    if (!communityId || !uid) return;

    const beforeStatus = normalizeMembershipStatus(before);
    const afterStatus = normalizeMembershipStatus(after);
    const leftActiveMembership = beforeStatus === 'active' && afterStatus !== 'active';
    const startedNewMembershipCycle = membershipCycleChanged(before, after);

    if (leftActiveMembership || startedNewMembershipCycle) {
      const summaryRef = db
        .collection('community_notification_summaries')
        .doc(uid)
        .collection('items')
        .doc(communityId);
      const preferenceRef = db
        .collection('community_notification_preferences')
        .doc(uid)
        .collection('items')
        .doc(communityId);
      const batch = db.batch();

      // O resumo é apenas read model e pode ser reconstruído. O estado aplicado
      // por notificationId fica intacto para preservar idempotência/histórico.
      batch.delete(summaryRef);
      if (leftActiveMembership) {
        // Mute por Comunidade é preferência privada descartável da participação.
        // Preferências globais e notificações canônicas não são tocadas.
        batch.delete(preferenceRef);
      }
      await batch.commit();

      logger.debug('community_membership_notification_projection_converged', {
        communityId,
        uid,
        leftActiveMembership,
        startedNewMembershipCycle,
      });
    }

    if (!isCommunityMembershipTransitionMeaningful(before, after)) return;

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
