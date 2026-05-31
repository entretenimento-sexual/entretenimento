// functions/src/chat/direct-chat/application/ensure-direct-chat.handler.ts
// -----------------------------------------------------------------------------
// ENSURE DIRECT CHAT HANDLER
// -----------------------------------------------------------------------------
// Resolve ou cria uma única conversa direta entre dois usuários.
//
// Segurança:
// - o cliente informa somente otherUserUid;
// - actorUid vem exclusivamente de request.auth.uid;
// - e-mail verificado é exigido para iniciar/recuperar conversa;
// - lifecycle dos dois perfis é validado no backend;
// - conversa nova exige amizade aceita;
// - consultas internas por participantsKey deixam de ser feitas pelo cliente.
//
// Migração:
// - chats legados existentes são adotados para preservar histórico;
// - um registry interno passa a fixar o chat canônico do par;
// - novos chats usam ID determinístico, evitando duplicidade futura.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../../firebaseApp';
import { FUNCTIONS_REGION } from '../../../config/functions-region';

import {
  assertMessagingAccountOperational,
} from '../../shared/messaging-account.policy';
import type {
  MessagingUserDoc,
} from '../../shared/messaging.types';

import {
  DIRECT_CHAT_POLICY_VERSION,
  assertCanCreateNewDirectChat,
} from '../domain/direct-chat.policy';

interface EnsureDirectChatRequest {
  otherUserUid?: unknown;
}

interface EnsureDirectChatResponse {
  chatId: string;
  created: boolean;
  resolution:
    | 'registered'
    | 'legacy-adopted'
    | 'deterministic-recovered'
    | 'created';
}

interface DirectChatPairRegistryDoc {
  chatId?: unknown;
}

interface StoredDirectChatDoc {
  participants?: unknown;
  timestamp?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
}

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

function buildParticipants(actorUid: string, targetUid: string): string[] {
  return [actorUid, targetUid].sort();
}

function buildParticipantsKey(participants: string[]): string {
  return participants.join('_');
}

function buildPairHash(participantsKey: string): string {
  return createHash('sha256').update(participantsKey).digest('hex');
}

function isSameParticipantPair(
  chat: StoredDirectChatDoc | undefined,
  expectedParticipants: string[]
): boolean {
  if (!Array.isArray(chat?.participants)) {
    return false;
  }

  const actualParticipants = chat.participants
    .map((participant) => String(participant ?? '').trim())
    .filter(Boolean)
    .sort();

  return (
    actualParticipants.length === expectedParticipants.length &&
    actualParticipants.every(
      (participant, index) => participant === expectedParticipants[index]
    )
  );
}

function timestampMillis(value: unknown): number {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return Number((value as { toMillis: () => number }).toMillis()) || 0;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return 0;
}

/**
 * Havendo duplicidade legada, preserva como canônica a conversa com atividade
 * mais recente. As demais não são removidas automaticamente; a ocorrência é
 * auditada para tratamento posterior seguro.
 */
function selectCanonicalLegacyChat(
  documents: FirebaseFirestore.QueryDocumentSnapshot[]
): FirebaseFirestore.QueryDocumentSnapshot | null {
  if (!documents.length) {
    return null;
  }

  return [...documents].sort((left, right) => {
    const leftData = left.data() as StoredDirectChatDoc;
    const rightData = right.data() as StoredDirectChatDoc;

    const leftActivity =
      timestampMillis(leftData.updatedAt) ||
      timestampMillis(leftData.timestamp) ||
      timestampMillis(leftData.createdAt);

    const rightActivity =
      timestampMillis(rightData.updatedAt) ||
      timestampMillis(rightData.timestamp) ||
      timestampMillis(rightData.createdAt);

    if (leftActivity !== rightActivity) {
      return rightActivity - leftActivity;
    }

    return left.id.localeCompare(right.id);
  })[0];
}

export const ensureDirectChat = onCall<EnsureDirectChatRequest>(
  { region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<EnsureDirectChatResponse> => {
    const actorUid = normalizeUid(request.auth?.uid);
    const targetUid = normalizeUid(request.data?.otherUserUid);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    console.log('[ensureDirectChat][debug]', {
      actorUid,
      targetUid,
      hasAuth: !!request.auth,
      emailVerified: request.auth?.token?.email_verified ?? null,
    });

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de iniciar conversas.'
      );
    }

    if (!targetUid) {
      throw new HttpsError(
        'invalid-argument',
        'Perfil de destino não identificado.'
      );
    }

    if (actorUid === targetUid) {
      throw new HttpsError(
        'failed-precondition',
        'Não é possível iniciar uma conversa consigo mesmo.'
      );
    }

    const participants = buildParticipants(actorUid, targetUid);
    const participantsKey = buildParticipantsKey(participants);
    const pairHash = buildPairHash(participantsKey);

    const actorRef = db.collection('users').doc(actorUid);
    const targetRef = db.collection('users').doc(targetUid);

    const actorFriendRef = actorRef.collection('friends').doc(targetUid);
    const targetFriendRef = targetRef.collection('friends').doc(actorUid);

    /**
     * Registro interno de par -> chat canônico.
     * O cliente não deverá ler nem escrever nesta coleção.
     */
    const registryRef = db.collection('direct_chat_pairs').doc(pairHash);

    /**
     * Novas conversas passam a usar ID determinístico.
     * Conversas antigas mantêm o ID original quando adotadas.
     */
    const deterministicChatRef = db
      .collection('chats')
      .doc(`direct_${pairHash}`);

    /**
     * Esta consulta hoje é negada no cliente. No backend, ela é executada para
     * localizar e adotar histórico legado sem permitir novas duplicidades.
     */
    const legacyQuery = db
      .collection('chats')
      .where('participantsKey', '==', participantsKey)
      .limit(10);

    const auditRef = db.collection('direct_chat_audit').doc();

    return db.runTransaction(async (transaction) => {
      const [
        actorSnapshot,
        targetSnapshot,
        actorFriendSnapshot,
        targetFriendSnapshot,
        registrySnapshot,
        deterministicChatSnapshot,
        legacySnapshot,
      ] = await Promise.all([
        transaction.get(actorRef),
        transaction.get(targetRef),
        transaction.get(actorFriendRef),
        transaction.get(targetFriendRef),
        transaction.get(registryRef),
        transaction.get(deterministicChatRef),
        transaction.get(legacyQuery),
      ]);

      const actor = actorSnapshot.data() as MessagingUserDoc | undefined;
      const target = targetSnapshot.data() as MessagingUserDoc | undefined;

      console.log('[ensureDirectChat][users]', {
  actorExists: actorSnapshot.exists,
  targetExists: targetSnapshot.exists,
  actor: {
    uid: actor?.uid ?? null,
    profileCompleted: actor?.profileCompleted ?? null,
    accountStatus: actor?.accountStatus ?? null,
    interactionBlocked: actor?.interactionBlocked ?? null,
    accountLocked: actor?.accountLocked ?? null,
    loginAllowed: actor?.loginAllowed ?? null,
  },
  target: {
    uid: target?.uid ?? null,
    profileCompleted: target?.profileCompleted ?? null,
    accountStatus: target?.accountStatus ?? null,
    interactionBlocked: target?.interactionBlocked ?? null,
    accountLocked: target?.accountLocked ?? null,
    loginAllowed: target?.loginAllowed ?? null,
  },
});

      assertMessagingAccountOperational(actor, {
        operation: 'ensure-direct-chat',
        perspective: 'actor',
      });

      assertMessagingAccountOperational(target, {
        operation: 'ensure-direct-chat',
        perspective: 'target',
      });

      const registry =
        registrySnapshot.data() as DirectChatPairRegistryDoc | undefined;

      const registeredChatId = normalizeUid(registry?.chatId);

      if (registeredChatId) {
        const registeredChatRef = db.collection('chats').doc(registeredChatId);

        const registeredChatSnapshot =
          registeredChatId === deterministicChatRef.id
            ? deterministicChatSnapshot
            : await transaction.get(registeredChatRef);

        if (
          !registeredChatSnapshot.exists ||
          !isSameParticipantPair(
            registeredChatSnapshot.data() as StoredDirectChatDoc | undefined,
            participants
          )
        ) {
          throw new HttpsError(
            'data-loss',
            'Não foi possível validar a conversa existente.'
          );
        }

        return {
          chatId: registeredChatId,
          created: false,
          resolution: 'registered',
        };
      }

      const legacyCandidates = legacySnapshot.docs.filter((snapshot) =>
        isSameParticipantPair(
          snapshot.data() as StoredDirectChatDoc | undefined,
          participants
        )
      );

      const canonicalLegacyChat =
        selectCanonicalLegacyChat(legacyCandidates);

      if (canonicalLegacyChat) {
        transaction.set(registryRef, {
          chatId: canonicalLegacyChat.id,
          pairHash,
          participants,
          source: 'legacy-adopted',
          duplicateCandidatesDetected: legacyCandidates.length > 1,
          duplicateCandidateIds:
            legacyCandidates.length > 1
              ? legacyCandidates.map((snapshot) => snapshot.id)
              : [],
          policyVersion: DIRECT_CHAT_POLICY_VERSION,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.set(auditRef, {
          action: 'adopt-legacy-direct-chat',
          actorUid,
          targetUid,
          chatId: canonicalLegacyChat.id,
          pairHash,
          duplicateCandidatesDetected: legacyCandidates.length > 1,
          duplicateCandidateIds:
            legacyCandidates.length > 1
              ? legacyCandidates.map((snapshot) => snapshot.id)
              : [],
          policyVersion: DIRECT_CHAT_POLICY_VERSION,
          createdAt: FieldValue.serverTimestamp(),
        });

        return {
          chatId: canonicalLegacyChat.id,
          created: false,
          resolution: 'legacy-adopted',
        };
      }

      if (deterministicChatSnapshot.exists) {
        if (
          !isSameParticipantPair(
            deterministicChatSnapshot.data() as StoredDirectChatDoc | undefined,
            participants
          )
        ) {
          throw new HttpsError(
            'data-loss',
            'Não foi possível validar a conversa existente.'
          );
        }

        transaction.set(registryRef, {
          chatId: deterministicChatRef.id,
          pairHash,
          participants,
          source: 'deterministic-recovered',
          policyVersion: DIRECT_CHAT_POLICY_VERSION,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return {
          chatId: deterministicChatRef.id,
          created: false,
          resolution: 'deterministic-recovered',
        };
      }

      assertCanCreateNewDirectChat({
        actorHasAcceptedFriendEdge: actorFriendSnapshot.exists,
        targetHasAcceptedFriendEdge: targetFriendSnapshot.exists,
      });

      transaction.set(deterministicChatRef, {
        participants,
        participantsKey,

        conversationType: 'direct',
        conversationStatus: 'active',
        isRoom: false,

        origin: 'accepted-friendship',
        policyVersion: DIRECT_CHAT_POLICY_VERSION,

        timestamp: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(registryRef, {
        chatId: deterministicChatRef.id,
        pairHash,
        participants,
        source: 'created',
        policyVersion: DIRECT_CHAT_POLICY_VERSION,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(auditRef, {
        action: 'create-direct-chat',
        actorUid,
        targetUid,
        chatId: deterministicChatRef.id,
        pairHash,
        origin: 'accepted-friendship',
        policyVersion: DIRECT_CHAT_POLICY_VERSION,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        chatId: deterministicChatRef.id,
        created: true,
        resolution: 'created',
      };
    });
  }
);