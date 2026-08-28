// firestore-rules/tests/rooms.rules.spec.ts
// -----------------------------------------------------------------------------
// FIRESTORE SECURITY RULES - PRIVATE ROOMS
// -----------------------------------------------------------------------------
//
// Escopo validado nesta suíte:
// - listagem privada de salas em que o usuário participa;
// - leitura individual da sala autorizada;
// - bloqueio de criação/mutação/exclusão direta pelo cliente;
// - proteção das coleções internas criadas pelo backend;
// - bloqueio por lifecycle, perfil incompleto e e-mail não verificado.
//
// Fora do escopo aprovado nesta etapa:
// - convites;
// - aceite/recusa de participação;
// - escrita na subcoleção legacy /participants;
// - mensagens da sala;
// - denúncia de sala.
//
// Esses fluxos ainda serão migrados para Functions antes de serem habilitados.

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
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;

const OWNER_UID = 'owner-room-user';
const OUTSIDER_UID = 'outsider-room-user';
const SUSPENDED_UID = 'suspended-room-user';
const UNVERIFIED_UID = 'unverified-room-user';
const INCOMPLETE_UID = 'incomplete-room-user';

const ROOM_ID = 'private-room-001';
const SLOT_ID = OWNER_UID;
const AUDIT_ID = 'room-audit-001';

let testEnv: RulesTestEnvironment;

function activeUser(uid: string): Record<string, unknown> {
  return {
    uid,
    profileCompleted: true,
    accountStatus: 'active',
    interactionBlocked: false,
    accountLocked: false,
    loginAllowed: true,
  };
}

function roomDocument(): Record<string, unknown> {
  return {
    roomName: 'Sala privada segura',
    description: 'Sala criada exclusivamente pelo backend.',
    createdBy: OWNER_UID,
    participants: [OWNER_UID],
    memberCount: 1,
    membershipMode: 'invite_only',
    isRoom: true,
    isPrivate: true,
    roomType: 'private',
    visibility: 'hidden',
    status: 'active',
    policyVersion: 'private-room-v1',
    entitlementRoleAtCreation: 'basic',
    creationTime: new Date(),
    lastActivity: new Date(),
    updatedAt: new Date(),
  };
}

function authenticatedDb(uid: string, emailVerified = true) {
  return testEnv
    .authenticatedContext(uid, {
      email_verified: emailVerified,
    })
    .firestore();
}

async function seedDatabase(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(doc(db, 'users', OWNER_UID), activeUser(OWNER_UID)),
      setDoc(doc(db, 'users', OUTSIDER_UID), activeUser(OUTSIDER_UID)),
      setDoc(doc(db, 'users', UNVERIFIED_UID), activeUser(UNVERIFIED_UID)),
      setDoc(doc(db, 'users', INCOMPLETE_UID), {
        ...activeUser(INCOMPLETE_UID),
        profileCompleted: false,
      }),
      setDoc(doc(db, 'users', SUSPENDED_UID), {
        ...activeUser(SUSPENDED_UID),
        accountStatus: 'suspended',
        interactionBlocked: true,
      }),

      setDoc(doc(db, 'rooms', ROOM_ID), roomDocument()),

      setDoc(doc(db, 'rooms', ROOM_ID, 'members', OWNER_UID), {
        uid: OWNER_UID,
        membershipRole: 'owner',
        status: 'active',
        joinedAt: new Date(),
        updatedAt: new Date(),
      }),

      setDoc(doc(db, 'room_owner_slots', SLOT_ID), {
        uid: OWNER_UID,
        roomId: ROOM_ID,
        active: true,
        maxOwnedActiveRooms: 1,
        policyVersion: 'private-room-v1',
      }),

      setDoc(doc(db, 'room_audit', AUDIT_ID), {
        action: 'create_private_room',
        actorUid: OWNER_UID,
        roomId: ROOM_ID,
        policyVersion: 'private-room-v1',
      }),
    ]);
  });
}

describe('Firestore Rules / rooms', () => {
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

  it('permite ao participante ativo listar suas salas com limite de 30 documentos', async () => {
    const db = authenticatedDb(OWNER_UID);

    const roomsQuery = query(
      collection(db, 'rooms'),
      where('participants', 'array-contains', OWNER_UID),
      limit(30)
    );

    const snapshot = await assertSucceeds(getDocs(roomsQuery));

    expect(snapshot.size).toBe(1);
    expect(snapshot.docs[0]?.id).toBe(ROOM_ID);
  });

  it('nega listagem de salas sem limite explícito', async () => {
    const db = authenticatedDb(OWNER_UID);

    const roomsQuery = query(
      collection(db, 'rooms'),
      where('participants', 'array-contains', OWNER_UID)
    );

    await assertFails(getDocs(roomsQuery));
  });

  it('nega listagem com limite superior a 30 documentos', async () => {
    const db = authenticatedDb(OWNER_UID);

    const roomsQuery = query(
      collection(db, 'rooms'),
      where('participants', 'array-contains', OWNER_UID),
      limit(31)
    );

    await assertFails(getDocs(roomsQuery));
  });

  it('nega tentativa de listar salas de outro participante', async () => {
    const db = authenticatedDb(OUTSIDER_UID);

    const roomsQuery = query(
      collection(db, 'rooms'),
      where('participants', 'array-contains', OWNER_UID),
      limit(30)
    );

    await assertFails(getDocs(roomsQuery));
  });

  it('permite ao participante ativo ler diretamente sua sala', async () => {
    const db = authenticatedDb(OWNER_UID);

    const snapshot = await assertSucceeds(
      getDoc(doc(db, 'rooms', ROOM_ID))
    );

    expect(snapshot.exists()).toBe(true);
  });

  it('nega leitura direta da sala para usuário não participante', async () => {
    const db = authenticatedDb(OUTSIDER_UID);

    await assertFails(getDoc(doc(db, 'rooms', ROOM_ID)));
  });

  it('nega leitura da sala sem autenticação', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(db, 'rooms', ROOM_ID)));
  });

  it('nega criação direta de sala pelo cliente autenticado', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      setDoc(doc(db, 'rooms', 'client-created-room'), {
        ...roomDocument(),
        roomName: 'Tentativa de criação direta',
      })
    );
  });

  it('nega alteração direta do array de participantes pelo dono', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      updateDoc(doc(db, 'rooms', ROOM_ID), {
        participants: [OWNER_UID, OUTSIDER_UID],
        lastActivity: new Date(),
      })
    );
  });

  it('nega exclusão direta da sala pelo dono', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(deleteDoc(doc(db, 'rooms', ROOM_ID)));
  });

  it('nega leitura do slot interno de limite ao próprio dono', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      getDoc(doc(db, 'room_owner_slots', SLOT_ID))
    );
  });

  it('nega leitura da auditoria interna ao próprio ator', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      getDoc(doc(db, 'room_audit', AUDIT_ID))
    );
  });

  it('nega leitura do membership backend enquanto não houver contrato cliente seguro', async () => {
    const db = authenticatedDb(OWNER_UID);

    await assertFails(
      getDoc(doc(db, 'rooms', ROOM_ID, 'members', OWNER_UID))
    );
  });

  it('nega listagem e leitura para conta suspensa ou bloqueada', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      await updateDoc(doc(db, 'rooms', ROOM_ID), {
        createdBy: SUSPENDED_UID,
        participants: [SUSPENDED_UID],
      });
    });

    const db = authenticatedDb(SUSPENDED_UID);

    const roomsQuery = query(
      collection(db, 'rooms'),
      where('participants', 'array-contains', SUSPENDED_UID),
      limit(30)
    );

    await assertFails(getDocs(roomsQuery));
    await assertFails(getDoc(doc(db, 'rooms', ROOM_ID)));
  });

  it('nega listagem e leitura para usuário sem e-mail verificado', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      await updateDoc(doc(db, 'rooms', ROOM_ID), {
        createdBy: UNVERIFIED_UID,
        participants: [UNVERIFIED_UID],
      });
    });

    const db = authenticatedDb(UNVERIFIED_UID, false);

    const roomsQuery = query(
      collection(db, 'rooms'),
      where('participants', 'array-contains', UNVERIFIED_UID),
      limit(30)
    );

    await assertFails(getDocs(roomsQuery));
    await assertFails(getDoc(doc(db, 'rooms', ROOM_ID)));
  });

  it('nega listagem e leitura para usuário com perfil incompleto', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      await updateDoc(doc(db, 'rooms', ROOM_ID), {
        createdBy: INCOMPLETE_UID,
        participants: [INCOMPLETE_UID],
      });
    });

    const db = authenticatedDb(INCOMPLETE_UID);

    const roomsQuery = query(
      collection(db, 'rooms'),
      where('participants', 'array-contains', INCOMPLETE_UID),
      limit(30)
    );

    await assertFails(getDocs(roomsQuery));
    await assertFails(getDoc(doc(db, 'rooms', ROOM_ID)));
  });
});