// firestore-rules/tests/community-membership-lifecycle.rules.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const COMMUNITY_ID = 'community-lifecycle';
const MEMBER_UID = 'community-member';
const MODERATOR_UID = 'community-moderator';
const PENDING_UID = 'community-pending';
const VENUE_CREATION_REQUEST_ID = 'request-local-lifecycle';
const COMMUNITY_CREATION_REQUEST_ID = 'request-community-lifecycle';

let testEnv: RulesTestEnvironment;

function membership(
  uid: string,
  role: 'member' | 'moderator',
  status: 'active' | 'pending'
) {
  return {
    communityId: COMMUNITY_ID,
    uid,
    role,
    status,
    requestedAt: new Date(),
    joinedAt: status === 'active' ? new Date() : null,
    updatedAt: new Date(),
  };
}

async function seed(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(doc(db, 'communities', COMMUNITY_ID), {
        name: 'Comunidade de ciclo',
        slug: 'comunidade-de-ciclo',
        source: { type: 'venue', id: 'venue-1' },
        status: 'active',
        visibility: 'public_preview',
        access: {
          preview: 'authenticated',
          interaction: 'members_only',
          join: 'approval',
        },
        moderation: { state: 'active' },
        metrics: { memberCount: 2, postCount: 0, mediaCount: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      setDoc(
        doc(db, 'communities', COMMUNITY_ID, 'members', MEMBER_UID),
        membership(MEMBER_UID, 'member', 'active')
      ),
      setDoc(
        doc(db, 'communities', COMMUNITY_ID, 'members', MODERATOR_UID),
        membership(MODERATOR_UID, 'moderator', 'active')
      ),
      setDoc(
        doc(db, 'communities', COMMUNITY_ID, 'members', PENDING_UID),
        membership(PENDING_UID, 'member', 'pending')
      ),
      setDoc(doc(db, 'community_membership_audit', 'audit-1'), {
        action: 'community-membership-requested',
        communityId: COMMUNITY_ID,
        actorUid: PENDING_UID,
        subjectUid: PENDING_UID,
        status: 'pending',
        createdAt: new Date(),
        source: 'callable',
      }),
      setDoc(
        doc(
          db,
          'venue_community_creation_requests',
          VENUE_CREATION_REQUEST_ID
        ),
        {
          actorUid: MEMBER_UID,
          venueId: 'venue-request-local-lifecycle',
          communityId: 'community-request-local-lifecycle',
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      ),
      setDoc(
        doc(
          db,
          'community_creation_requests',
          COMMUNITY_CREATION_REQUEST_ID
        ),
        {
          actorUid: MEMBER_UID,
          communityId: 'community-request-lifecycle',
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      ),
      setDoc(
        doc(db, 'community_user_index', MEMBER_UID, 'items', COMMUNITY_ID),
        {
          communityId: COMMUNITY_ID,
          name: 'Comunidade de ciclo',
          source: { type: 'community', id: COMMUNITY_ID },
          role: 'member',
          status: 'active',
          updatedAt: new Date(),
        }
      ),
    ]);
  });
}

describe('Firestore Rules / community membership lifecycle', () => {
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
    await seed();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega saída direta do próprio membro', async () => {
    const db = testEnv.authenticatedContext(MEMBER_UID).firestore();

    await assertFails(
      updateDoc(
        doc(db, 'communities', COMMUNITY_ID, 'members', MEMBER_UID),
        { status: 'left', leftAt: new Date(), updatedAt: new Date() }
      )
    );
  });

  it('nega aprovação e recusa diretas pela moderação', async () => {
    const db = testEnv.authenticatedContext(MODERATOR_UID).firestore();
    const targetRef = doc(
      db,
      'communities',
      COMMUNITY_ID,
      'members',
      PENDING_UID
    );

    await assertFails(
      updateDoc(targetRef, {
        status: 'active',
        reviewedBy: MODERATOR_UID,
        updatedAt: new Date(),
      })
    );
    await assertFails(
      updateDoc(targetRef, {
        status: 'left',
        reviewedBy: MODERATOR_UID,
        updatedAt: new Date(),
      })
    );
  });

  it('nega listagem da fila de memberships ao cliente', async () => {
    const db = testEnv.authenticatedContext(MODERATOR_UID).firestore();

    await assertFails(
      getDocs(collection(db, 'communities', COMMUNITY_ID, 'members'))
    );
  });

  it('nega leitura e escrita da auditoria ao cliente', async () => {
    const db = testEnv.authenticatedContext(MODERATOR_UID).firestore();
    const auditRef = doc(db, 'community_membership_audit', 'audit-1');

    await assertFails(getDoc(auditRef));
    await assertFails(
      setDoc(doc(db, 'community_membership_audit', 'audit-client'), {
        action: 'community-membership-approved',
      })
    );
  });

  it('nega leitura e escrita dos registros idempotentes de criação', async () => {
    const db = testEnv.authenticatedContext(MEMBER_UID).firestore();
    const venueRequestRef = doc(
      db,
      'venue_community_creation_requests',
      VENUE_CREATION_REQUEST_ID
    );
    const communityRequestRef = doc(
      db,
      'community_creation_requests',
      COMMUNITY_CREATION_REQUEST_ID
    );

    await assertFails(getDoc(venueRequestRef));
    await assertFails(getDoc(communityRequestRef));
    await assertFails(
      setDoc(
        doc(db, 'community_creation_requests', 'request-client-community'),
        {
          actorUid: MEMBER_UID,
          communityId: 'community-client',
          status: 'completed',
        }
      )
    );
  });

  it('nega leitura, listagem e escrita direta do índice privado', async () => {
    const db = testEnv.authenticatedContext(MEMBER_UID).firestore();
    const indexRef = doc(
      db,
      'community_user_index',
      MEMBER_UID,
      'items',
      COMMUNITY_ID
    );

    await assertFails(getDoc(indexRef));
    await assertFails(
      getDocs(collection(db, 'community_user_index', MEMBER_UID, 'items'))
    );
    await assertFails(
      setDoc(indexRef, {
        communityId: COMMUNITY_ID,
        role: 'owner',
        status: 'active',
      })
    );
  });
});
