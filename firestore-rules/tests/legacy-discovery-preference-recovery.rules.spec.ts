// Security regression for a future backend-only legacy recovery quarantine.
// The values used below are synthetic. No production or operator data is used.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-legacy-discovery-recovery-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const ROOT = 'legacy_discovery_preference_recovery';
const OWNER = 'recovery-owner';
const VISITOR = 'recovery-visitor';
const ADMIN = 'recovery-admin';

let testEnv: RulesTestEnvironment;

function sampleRecord() {
  return {
    schemaVersion: 1,
    ownerUid: OWNER,
    sourceCollection: 'public_profiles',
    lifecycle: 'PENDING_REVIEW',
    legacyRaw: {
      interestedInGenders: ['synthetic-woman', 'synthetic-man'],
      interestedInOrientations: ['synthetic-bi'],
    },
    visibilityConsentConfirmed: false,
  };
}

describe('Firestore Rules / legacy preference recovery quarantine', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: FIRESTORE_HOST,
        port: FIRESTORE_PORT,
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, ROOT, OWNER), sampleRecord());
      await setDoc(doc(db, ROOT, OWNER, 'history', 'entry-1'), {
        action: 'SNAPSHOT_RECORDED',
        actorType: 'BACKEND',
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  const actors = [
    {
      name: 'anonymous',
      database: () => testEnv.unauthenticatedContext().firestore(),
    },
    {
      name: 'owner',
      database: () => testEnv.authenticatedContext(OWNER).firestore(),
    },
    {
      name: 'visitor',
      database: () => testEnv.authenticatedContext(VISITOR).firestore(),
    },
    {
      name: 'admin with custom claims',
      database: () => testEnv.authenticatedContext(ADMIN, {
        admin: true, superadmin: true, role: 'admin',
      }).firestore(),
    },
    {
      name: 'moderator',
      database: () => testEnv.authenticatedContext('recovery-moderator', {
        moderator: true, role: 'moderator',
      }).firestore(),
    },
  ];

  for (const actor of actors) {
    it(`denies get/list of recovery records to ${actor.name}`, async () => {
      const db = actor.database();
      await assertFails(getDoc(doc(db, ROOT, OWNER)));
      await assertFails(getDocs(collection(db, ROOT)));
      await assertFails(getDoc(doc(db, ROOT, OWNER, 'history', 'entry-1')));
      await assertFails(getDocs(collection(db, ROOT, OWNER, 'history')));
    });

    it(`denies all direct client writes to ${actor.name}`, async () => {
      const db = actor.database();
      await assertFails(setDoc(doc(db, ROOT, 'forged-record'), sampleRecord()));
      await assertFails(updateDoc(doc(db, ROOT, OWNER), {
        visibilityConsentConfirmed: true,
      }));
      await assertFails(deleteDoc(doc(db, ROOT, OWNER)));
      await assertFails(setDoc(
        doc(db, ROOT, OWNER, 'history', 'forged-entry'),
        { action: 'FORGED' }
      ));
      await assertFails(updateDoc(
        doc(db, ROOT, OWNER, 'history', 'entry-1'),
        { action: 'FORGED' }
      ));
      await assertFails(deleteDoc(doc(db, ROOT, OWNER, 'history', 'entry-1')));
    });
  }

  it('does not expose history through a collection group query', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(getDocs(collectionGroup(db, 'history')));
  });

  it('isolates the recovery namespace from public profile reads', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(getDoc(doc(db, ROOT, VISITOR)));
    await assertFails(getDocs(collection(db, ROOT)));
  });
});
