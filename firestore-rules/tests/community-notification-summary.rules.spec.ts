// firestore-rules/tests/community-notification-summary.rules.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const USER_UID = 'notification-summary-user';
const OTHER_UID = 'notification-summary-other';

let testEnv: RulesTestEnvironment;

describe('Firestore Rules / community_notification_summaries', () => {
  beforeAll(async () => {
    const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
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
      await setDoc(
        doc(context.firestore(), 'community_notification_summaries', USER_UID),
        {
          projectionVersion: 2,
          unreadCount: 7,
          priorityUnreadCount: 2,
          priorityCommunityCount: 1,
          attentionWindow: [],
        }
      );
      await setDoc(
        doc(
          context.firestore(),
          'community_notification_summaries',
          USER_UID,
          'items',
          'community-1'
        ),
        {
          communityId: 'community-1',
          unreadCount: 7,
          priorityUnreadCount: 2,
        }
      );
    });
  });

  afterAll(async () => testEnv.cleanup());

  it('permite ao usuário ler apenas o próprio agregado global', async () => {
    const ownDb = testEnv.authenticatedContext(USER_UID).firestore();
    const otherDb = testEnv.authenticatedContext(OTHER_UID).firestore();

    await assertSucceeds(
      getDoc(doc(ownDb, 'community_notification_summaries', USER_UID))
    );
    await assertFails(
      getDoc(doc(otherDb, 'community_notification_summaries', USER_UID))
    );
  });

  it('preserva leitura privada do detalhe e bloqueia enumeração dos pais', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertSucceeds(
      getDoc(
        doc(
          db,
          'community_notification_summaries',
          USER_UID,
          'items',
          'community-1'
        )
      )
    );
    await assertSucceeds(
      getDocs(
        collection(
          db,
          'community_notification_summaries',
          USER_UID,
          'items'
        )
      )
    );
    await assertFails(
      getDocs(collection(db, 'community_notification_summaries'))
    );
  });

  it('nega mutação do agregado global e do detalhe pelo navegador', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      setDoc(
        doc(db, 'community_notification_summaries', USER_UID),
        { unreadCount: 999 }
      )
    );
    await assertFails(
      setDoc(
        doc(
          db,
          'community_notification_summaries',
          USER_UID,
          'items',
          'community-2'
        ),
        { unreadCount: 999 }
      )
    );
  });
});
