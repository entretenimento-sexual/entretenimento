// Reconciliação sob demanda, limitada ao par solicitado pelo participante.
// Bloqueios canônicos são consultados em ambos os sentidos dentro da transação.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../../../firebaseApp';
import { FUNCTIONS_REGION } from '../../../config/functions-region';
import { consumeBackendRateLimitQuota } from '../../../shared/security/backend-rate-limit.service';
import { ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG } from '../domain/direct-chat.policy';
import { assertMessagingAccountOperational } from '../../shared/messaging-account.policy';
import type { MessagingUserDoc } from '../../shared/messaging.types';
import { assertPlatformAccountAccessData } from '../../../account_lifecycle/interaction-access.policy';

function uid(value: unknown): string {
  return typeof value === 'string' && value.trim() === value
    && value.length > 0 && value.length <= 128 && !value.includes('/')
    && ![...value].some((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127;
    }) ? value : '';
}

export const reconcileDirectChatAccess = onCall<{ peerUid?: unknown }>(
  { region: FUNCTIONS_REGION, invoker: 'public' },
  async (request): Promise<{ reconciled: boolean }> => {
    const actorUid = uid(request.auth?.uid);
    const peerUid = uid(request.data?.peerUid);
    if (!actorUid) throw new HttpsError('unauthenticated', 'Sessão necessária.');
    if (!peerUid || peerUid === actorUid) {
      throw new HttpsError('invalid-argument', 'Participante inválido.');
    }

    await consumeBackendRateLimitQuota({
      action: 'reconcile-direct-chat-access',
      subject: actorUid,
      config: ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG,
      message: 'Muitas solicitações. Tente novamente mais tarde.',
    });

    const actorRef = db.collection('users').doc(actorUid);
    const peerRef = db.collection('users').doc(peerUid);
    const actorAccessRef = db.doc(`direct_chat_access/${actorUid}/peers/${peerUid}`);
    const peerAccessRef = db.doc(`direct_chat_access/${peerUid}/peers/${actorUid}`);

    return db.runTransaction(async (tx) => {
      const [actor, peer, actorFriend, peerFriend, actorBlock, peerBlock, actorAccess, peerAccess] =
        await Promise.all([
          tx.get(actorRef),
          tx.get(peerRef),
          tx.get(actorRef.collection('friends').doc(peerUid)),
          tx.get(peerRef.collection('friends').doc(actorUid)),
          tx.get(actorRef.collection('blocks').doc(peerUid)),
          tx.get(peerRef.collection('blocks').doc(actorUid)),
          tx.get(actorAccessRef),
          tx.get(peerAccessRef),
        ]);
      // Nunca materializar projeção disponível para conta sem acesso ou vínculo bilateral.
      assertMessagingAccountOperational(actor.data() as MessagingUserDoc | undefined, {
        operation: 'ensure-direct-chat', perspective: 'actor',
      });
      assertMessagingAccountOperational(peer.data() as MessagingUserDoc | undefined, {
        operation: 'ensure-direct-chat', perspective: 'target',
      });
      assertPlatformAccountAccessData(actor.data());
      assertPlatformAccountAccessData(peer.data());

      const available = actorFriend.exists && peerFriend.exists
        && actorBlock.data()?.isBlocked !== true
        && peerBlock.data()?.isBlocked !== true;
      const matches = (snapshot: FirebaseFirestore.DocumentSnapshot) =>
        snapshot.data()?.available === available && snapshot.data()?.version === 1;
      if (!matches(actorAccess) || !matches(peerAccess)) {
        const projection = {
          available,
          version: 1,
          updatedAt: FieldValue.serverTimestamp(),
        };
        tx.set(actorAccessRef, projection);
        tx.set(peerAccessRef, projection);
      }
      // Retorno neutro: nunca informa qual participante bloqueou.
      return { reconciled: true };
    });
  }
);
