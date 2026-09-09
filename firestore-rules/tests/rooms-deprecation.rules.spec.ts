import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rooms-deprecation';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const OWNER_UID = 'legacy-room-owner';
const ROOM_ID = 'legacy-room-001';

let testEnv: RulesTestEnvironment;

function authenticatedDb() {
  return testEnv
    .authenticatedContext(OWNER_UID, { email_verified: true })
    .firestore();
}

async function seedDatabase(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', OWNER_UID), {
      uid: OWNER_UID,
      profileCompleted: true,
      accountStatus: 'active',
      interactionBlocked: false,
      accountLocked: false,
      loginAllowed: true,
    });

    await setDoc(doc(db, 'rooms', ROOM_ID), {
      roomName: 'Sala histórica',
      createdBy: OWNER_UID,
      participants: [OWNER_UID],
      status: 'active',
      roomType: 'private',
    });

    await setDoc(doc(db, 'rooms', ROOM_ID, 'participants', OWNER_UID), {
      uid: OWNER_UID,
      joinedAt: new Date(),
      removed: false,
    });

    await setDoc(doc(db, 'rooms', ROOM_ID, 'messages', 'legacy-message-001'), {
      senderId: OWNER_UID,
      content: 'Mensagem histórica',
      timestamp: new Date(),
    });
  });
}

describe('Firestore Rules / rooms deprecation', () => {
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
    await seedDatabase();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega nova representação client-side em rooms/{roomId}/participants', async () => {
    const db = authenticatedDb();

    await assertFails(
      setDoc(doc(db, 'rooms', ROOM_ID, 'participants', 'new-user'), {
        uid: 'new-user',
        joinedAt: new Date(),
        removed: false,
      })
    );
  });

  it('nega alteração do próprio participant legado pelo owner', async () => {
    const db = authenticatedDb();

    await assertFails(
      updateDoc(doc(db, 'rooms', ROOM_ID, 'participants', OWNER_UID), {
        removed: true,
        removedAt: new Date(),
      })
    );
  });

  it('mantém mensagens de Sala fechadas para leitura e escrita do cliente', async () => {
    const db = authenticatedDb();
    const messageRef = doc(
      db,
      'rooms',
      ROOM_ID,
      'messages',
      'legacy-message-001'
    );

    await assertFails(getDoc(messageRef));
    await assertFails(
      setDoc(doc(db, 'rooms', ROOM_ID, 'messages', 'new-message'), {
        senderId: OWNER_UID,
        content: 'Tentativa de nova mensagem',
        timestamp: new Date(),
      })
    );
  });
});
