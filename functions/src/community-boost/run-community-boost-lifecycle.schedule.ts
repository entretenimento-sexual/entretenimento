// functions/src/community-boost/run-community-boost-lifecycle.schedule.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST LIFECYCLE
// -----------------------------------------------------------------------------
// Placements e frequency caps usam TTL do Firestore. O scheduler não os varre;
// ele apenas fecha campanhas cujo período patrocinado terminou.
// -----------------------------------------------------------------------------

import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';

const SWEEP_LIMIT = 200;

async function completeEndedCampaigns(now: number): Promise<number> {
  const snapshot = await db
    .collection('community_boost_campaigns')
    .where('status', '==', 'active')
    .where('endsAt', '<=', now)
    .orderBy('endsAt', 'asc')
    .limit(SWEEP_LIMIT)
    .get();

  if (snapshot.empty) return 0;

  const batch = db.batch();
  for (const document of snapshot.docs) {
    batch.update(document.ref, {
      status: 'completed',
      updatedAt: now,
    });
    batch.create(db.collection('community_boost_audit').doc(), {
      action: 'community_boost_campaign_completed_by_schedule',
      campaignId: document.id,
      createdAt: now,
    });
  }
  await batch.commit();
  return snapshot.size;
}

export const runCommunityBoostLifecycle = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
  },
  async () => {
    await completeEndedCampaigns(Date.now());
  }
);
