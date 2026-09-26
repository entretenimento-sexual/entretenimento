// functions/src/promotion-boost/run-promotion-boost-lifecycle.schedule.ts
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';

const SWEEP_LIMIT = 200;

export const runPromotionBoostLifecycle = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
  },
  async () => {
    const now = Date.now();
    const snapshot = await db
      .collection('promotion_boost_campaigns')
      .where('status', 'in', ['active', 'paused'])
      .where('endsAt', '<=', now)
      .orderBy('endsAt', 'asc')
      .limit(SWEEP_LIMIT)
      .get();

    if (snapshot.empty) return;

    const batch = db.batch();
    for (const document of snapshot.docs) {
      const campaign = document.data() ?? {};
      batch.update(document.ref, { status: 'completed', updatedAt: now });
      if (campaign['targetType'] === 'photo') {
        const ownerUid = String(campaign['targetOwnerUid'] ?? '').trim();
        const photoId = String(campaign['targetId'] ?? '').trim();
        if (ownerUid && photoId) {
          batch.delete(
            db.collection('promotion_boost_active_slots').doc(
              `photo:${ownerUid}:${photoId}`
            )
          );
        }
      }
      batch.create(db.collection('promotion_boost_audit').doc(), {
        action: 'promotion_boost_campaign_completed_by_schedule',
        campaignId: document.id,
        targetType: campaign['targetType'] ?? null,
        createdAt: now,
      });
    }
    await batch.commit();
  }
);
