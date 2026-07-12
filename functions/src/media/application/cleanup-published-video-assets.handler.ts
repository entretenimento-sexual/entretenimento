import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { processPendingPublishedVideoAssetCleanupJobs } from './published-video-asset.service';

export const cleanupPendingPublishedVideoAssets = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    await processPendingPublishedVideoAssetCleanupJobs();
  }
);
