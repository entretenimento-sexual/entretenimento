import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-backend-rate-limits-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const VIEWER_UID = 'rate-limit-viewer';
const VIEWER_HASH = createHash('sha256')
  .update(`public-video-playback-session:${VIEWER_UID}`)
  .digest('hex');
const RATE_LIMIT_ID = `public-video-playback-session__${VIEWER_HASH}`;

let testEnv: RulesTestEnvironment;

function rateLimitRef(db: Firestore) {
  return doc(db, 'backend_rate_limits', RATE_LIMIT_ID);
}

describe('Firestore Rules / backend rate limits', () => {
  beforeAll(async () => {
    const rules = readFileSync(
      resolve(process.cwd(), 'firestore.rules'),
      'utf8'
    );

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: FIRESTORE_HOST,
        port: FIRESTORE_PORT,
        rules,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(rateLimitRef(context.firestore()), {
        schemaVersion: 1,
        action: 'startPublicVideoPlaybackSession',
        burstWindowStartedAt: Date.now(),
        burstCount: 1,
        sustainedWindowStartedAt: Date.now(),
        sustainedCount: 1,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega leitura autenticada dos contadores internos', async () => {
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();

    await assertFails(getDoc(rateLimitRef(db)));
  });

  it('nega leitura não autenticada dos contadores internos', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(getDoc(rateLimitRef(db)));
  });

  it('nega criação, alteração e exclusão pelo cliente', async () => {
    const db = testEnv.authenticatedContext(VIEWER_UID).firestore();
    const ref = rateLimitRef(db);

    await assertFails(
      setDoc(
        doc(db, 'backend_rate_limits', 'forged-rate-limit'),
        { burstCount: 0 }
      )
    );
    await assertFails(updateDoc(ref, { burstCount: 0 }));
    await assertFails(deleteDoc(ref));
  });
});
