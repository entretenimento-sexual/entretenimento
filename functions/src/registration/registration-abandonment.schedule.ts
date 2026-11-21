import { info } from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { auth, db } from '../firebaseApp';
import { sweepRegistrationAbandonment } from './registration-abandonment.service';

export const sweepIncompleteRegistrations = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: '17 * * * *',
    timeZone: 'America/Sao_Paulo',
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: 480,
  },
  async () => {
    const result = await sweepRegistrationAbandonment(db, auth, {
      apply: true,
      nowMs: Date.now(),
      scheduled: true,
    });
    info('Triagem de cadastros incompletos por página.', result);
  },
);
