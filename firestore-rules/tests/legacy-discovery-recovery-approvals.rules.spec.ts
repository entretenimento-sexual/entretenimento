// Issue #236 — proposed approval ledger is invisible to EVERY client.
// Synthetic data only. Server Admin SDK bypasses Rules but no writer exists.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT = 'demo-legacy-recovery-approval-rules';
const ROOT = 'legacy_discovery_recovery_approvals';
const OPERATION = 'synthetic-approval-operation';
const OWNER = 'synthetic-operator';
const REVIEWER = 'synthetic-reviewer';

let env: RulesTestEnvironment;

describe('Firestore Rules / legacy discovery approval ledger', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT,
      firestore: {
        host: '127.0.0.1', port: 8180,
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, ROOT, OPERATION), {
        purpose: 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW',
        status: 'APPROVED_FOR_REVIEW_ONLY',
        requestedByUid: OWNER,
        approvedByUid: REVIEWER,
      });
      await setDoc(doc(db, ROOT, OPERATION, 'internalAudit', 'receipt'), {
        event: 'SYNTHETIC_ONLY',
      });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  const actors = [
    {
      name: 'anonymous',
      database: () => env.unauthenticatedContext().firestore(),
    },
    {
      name: 'operator',
      database: () => env.authenticatedContext(OWNER).firestore(),
    },
    {
      name: 'independent reviewer',
      database: () => env.authenticatedContext(REVIEWER).firestore(),
    },
    {
      name: 'administrator with stale claims',
      database: () => env.authenticatedContext('synthetic-admin', {
        admin: true, superadmin: true, role: 'admin',
      }).firestore(),
    },
    {
      name: 'moderator',
      database: () => env.authenticatedContext('synthetic-moderator', {
        moderator: true, role: 'moderator',
      }).firestore(),
    },
  ];

  for (const actor of actors) {
    it(`denies ledger reads to ${actor.name}`, async () => {
      const db = actor.database();
      await assertFails(getDoc(doc(db, ROOT, OPERATION)));
      await assertFails(getDocs(collection(db, ROOT)));
      await assertFails(getDoc(doc(db, ROOT, OPERATION, 'internalAudit', 'receipt')));
      await assertFails(getDocs(collection(db, ROOT, OPERATION, 'internalAudit')));
    });

    it(`denies ledger writes to ${actor.name}`, async () => {
      const db = actor.database();
      await assertFails(setDoc(doc(db, ROOT, 'forged-operation'), {
        status: 'APPROVED_FOR_REVIEW_ONLY',
      }));
      await assertFails(updateDoc(doc(db, ROOT, OPERATION), {
        status: 'APPROVED_FOR_REVIEW_ONLY',
      }));
      await assertFails(deleteDoc(doc(db, ROOT, OPERATION)));
      await assertFails(setDoc(
        doc(db, ROOT, OPERATION, 'internalAudit', 'forged'),
        { event: 'FORGED' }
      ));
      await assertFails(updateDoc(
        doc(db, ROOT, OPERATION, 'internalAudit', 'receipt'),
        { event: 'FORGED' }
      ));
      await assertFails(deleteDoc(
        doc(db, ROOT, OPERATION, 'internalAudit', 'receipt')
      ));
    });
  }
});
