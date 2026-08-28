// firestore-rules/tests/communities.rules.spec.ts
// -----------------------------------------------------------------------------
// FIRESTORE SECURITY RULES - COMMUNITIES
// -----------------------------------------------------------------------------

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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;

const PUBLIC_COMMUNITY_ID = 'community-public';
const PRIVATE_COMMUNITY_ID = 'community-members';
const VISITOR_UID = 'community-visitor';
const MEMBER_UID = 'community-member';
const PENDING_UID = 'community-pending';
const BLOCKED_UID = 'community-blocked';

let testEnv: RulesTestEnvironment;

function communityDocument(
  visibility: 'public_preview' | 'members_only' = 'public_preview'
) {
  return {
    name: 'Comunidade de teste',
    slug: 'comunidade-de-teste',
    source: { type: 'venue', id: 'venue-1' },
    status: 'active',
    visibility,
    access: {
      preview:
        visibility === 'public_preview' ? 'authenticated' : 'members_only',
      interaction: 'members_only',
      join: 'approval',
    },
    moderation: { state: 'active' },
    metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function membershipDocument(
  communityId: string,
  uid: string,
  status: 'active' | 'pending' | 'blocked'
) {
  return {
    communityId,
    uid,
    role: 'member',
    status,
    joinedAt: new Date(),
    updatedAt: new Date(),
  };
}

async function seedCommunities(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(
        doc(db, 'communities', PUBLIC_COMMUNITY_ID),
        communityDocument('public_preview')
      ),
      setDoc(
        doc(db, 'communities', PRIVATE_COMMUNITY_ID),
        communityDocument('members_only')
      ),
      setDoc(
        doc(
          db,
          'communities',
          PRIVATE_COMMUNITY_ID,
          'members',
          MEMBER_UID
        ),
        membershipDocument(PRIVATE_COMMUNITY_ID, MEMBER_UID, 'active')
      ),
      setDoc(
        doc(
          db,
          'communities',
          PRIVATE_COMMUNITY_ID,
          'members',
          PENDING_UID
        ),
        membershipDocument(PRIVATE_COMMUNITY_ID, PENDING_UID, 'pending')
      ),
      setDoc(
        doc(
          db,
          'communities',
          PUBLIC_COMMUNITY_ID,
          'members',
          BLOCKED_UID
        ),
        membershipDocument(PUBLIC_COMMUNITY_ID, BLOCKED_UID, 'blocked')
      ),
    ]);
  });
}

function authenticatedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

describe('Firestore Rules / communities', () => {
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
    await seedCommunities();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite ao visitante autenticado abrir uma comunidade com prévia pública', async () => {
    const snapshot = await assertSucceeds(
      getDoc(
        doc(authenticatedDb(VISITOR_UID), 'communities', PUBLIC_COMMUNITY_ID)
      )
    );

    expect(snapshot.exists()).toBe(true);
  });

  it('nega prévia pública sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(db, 'communities', PUBLIC_COMMUNITY_ID)));
  });

  it('nega comunidade restrita para não integrante', async () => {
    await assertFails(
      getDoc(
        doc(authenticatedDb(VISITOR_UID), 'communities', PRIVATE_COMMUNITY_ID)
      )
    );
  });

  it('permite comunidade restrita para membro ativo', async () => {
    const snapshot = await assertSucceeds(
      getDoc(
        doc(authenticatedDb(MEMBER_UID), 'communities', PRIVATE_COMMUNITY_ID)
      )
    );

    expect(snapshot.exists()).toBe(true);
  });

  it('não trata membership pendente como participação ativa', async () => {
    await assertFails(
      getDoc(
        doc(authenticatedDb(PENDING_UID), 'communities', PRIVATE_COMMUNITY_ID)
      )
    );
  });

  it('nega a prévia pública para membership bloqueada', async () => {
    await assertFails(
      getDoc(
        doc(authenticatedDb(BLOCKED_UID), 'communities', PUBLIC_COMMUNITY_ID)
      )
    );
  });

  it('permite ao usuário ler somente o próprio membership', async () => {
    const db = authenticatedDb(MEMBER_UID);

    await assertSucceeds(
      getDoc(
        doc(db, 'communities', PRIVATE_COMMUNITY_ID, 'members', MEMBER_UID)
      )
    );

    await assertFails(
      getDoc(
        doc(db, 'communities', PRIVATE_COMMUNITY_ID, 'members', PENDING_UID)
      )
    );
  });

  it('nega enumeração de comunidades e de membros', async () => {
    const db = authenticatedDb(MEMBER_UID);

    await assertFails(getDocs(collection(db, 'communities')));
    await assertFails(
      getDocs(collection(db, 'communities', PRIVATE_COMMUNITY_ID, 'members'))
    );
  });

  it('nega criação, atualização e exclusão direta de comunidade', async () => {
    const db = authenticatedDb(MEMBER_UID);
    const newCommunityRef = doc(db, 'communities', 'community-client-created');
    const existingCommunityRef = doc(
      db,
      'communities',
      PUBLIC_COMMUNITY_ID
    );

    await assertFails(
      setDoc(newCommunityRef, communityDocument('public_preview'))
    );
    await assertFails(updateDoc(existingCommunityRef, { name: 'Alterada' }));
    await assertFails(deleteDoc(existingCommunityRef));
  });

  it('nega escrita de membership e leitura da projeção interna', async () => {
    const db = authenticatedDb(MEMBER_UID);

    await assertFails(
      setDoc(
        doc(db, 'communities', PUBLIC_COMMUNITY_ID, 'members', MEMBER_UID),
        membershipDocument(PUBLIC_COMMUNITY_ID, MEMBER_UID, 'active')
      )
    );

    await assertFails(
      getDoc(
        doc(
          db,
          'community_user_index',
          MEMBER_UID,
          'items',
          PUBLIC_COMMUNITY_ID
        )
      )
    );
  });
});
