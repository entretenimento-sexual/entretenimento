// functions/src/friendship/application/cancel-friend-request.handler.ts
// -----------------------------------------------------------------------------
// CANCEL FRIEND REQUEST HANDLER
// -----------------------------------------------------------------------------
// Cancela uma solicitação de amizade enviada de forma segura.
//
// Modelo de segurança:
//
// 1. Identidade:
//    - o usuário autenticado vem exclusivamente de request.auth.uid;
//    - o cliente não informa requesterUid nem targetUid;
//    - isso impede o cliente de cancelar solicitação em nome de outra pessoa.
//
// 2. Consentimento social:
//    - somente quem enviou a solicitação pode cancelá-la;
//    - somente solicitações ainda pendentes podem ser canceladas.
//
// 3. Auditoria:
//    - o documento de friendRequests é preservado como "canceled";
//    - também registramos um evento técnico em friendship_audit;
//    - isso ajuda debug, moderação futura e análise de abuso.
//
// 4. Expansão futura:
//    - compatível com web e mobile;
//    - evita depender de delete/update direto pelo cliente;
//    - prepara o fechamento das Firestore Rules para bloquear escrita direta.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

interface CancelFriendRequestPayload {
  requestId?: unknown;
}

interface CancelFriendRequestResponse {
  requestId: string;
  requesterUid: string;
  targetUid: string;
  status: 'canceled';
}

interface FriendRequestDoc {
  requesterUid?: unknown;
  targetUid?: unknown;
  status?: unknown;
}

/**
 * Normaliza valores vindos do cliente ou do Firestore.
 *
 * Motivo:
 * - evita comparação com undefined/null;
 * - remove espaços acidentais;
 * - mantém validações previsíveis.
 */
function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

export const cancelFriendRequest = onCall<CancelFriendRequestPayload>(
  {
    region: FUNCTIONS_REGION,

    /**
     * "public" aqui não significa sem segurança.
     *
     * Significa que a callable pode ser invocada por clientes Firebase,
     * mas a autorização real acontece dentro da função usando request.auth.
     */
    invoker: 'public',
  },
  async (request): Promise<CancelFriendRequestResponse> => {
    /**
     * actorUid é a única identidade confiável.
     * Nunca aceitar requesterUid enviado pelo cliente.
     */
    const actorUid = normalizeText(request.auth?.uid);
    const requestId = normalizeText(request.data?.requestId);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    /**
     * Exigimos e-mail verificado para ações sociais.
     *
     * Isso reduz abuso, spam e contas descartáveis interagindo com usuários.
     */
    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de cancelar solicitações.'
      );
    }

    if (!requestId) {
      throw new HttpsError('invalid-argument', 'Solicitação inválida.');
    }

    let result: CancelFriendRequestResponse | null = null;

    await db.runTransaction(async (transaction) => {
      const requestRef = db.collection('friendRequests').doc(requestId);
      const requestSnapshot = await transaction.get(requestRef);

      if (!requestSnapshot.exists) {
        throw new HttpsError('not-found', 'Solicitação não encontrada.');
      }

      const requestDoc = requestSnapshot.data() as FriendRequestDoc;

      const requesterUid = normalizeText(requestDoc.requesterUid);
      const targetUid = normalizeText(requestDoc.targetUid);
      const status = normalizeText(requestDoc.status);

      if (!requesterUid || !targetUid) {
        throw new HttpsError(
          'data-loss',
          'Solicitação possui dados inconsistentes.'
        );
      }

      /**
       * Não cancelamos solicitação já aceita, recusada ou cancelada.
       *
       * Isso evita corrida de estado:
       * - usuário A cancela;
       * - usuário B aceita ao mesmo tempo;
       * - transação garante que só um estado final válido prevaleça.
       */
      if (status !== 'pending') {
        throw new HttpsError(
          'failed-precondition',
          'Esta solicitação não está pendente.'
        );
      }

      /**
       * Somente quem enviou pode cancelar.
       *
       * O destinatário deve usar declineFriendRequest,
       * que cria outro evento semântico: recusa.
       */
      if (actorUid !== requesterUid) {
        throw new HttpsError(
          'permission-denied',
          'Somente quem enviou pode cancelar esta solicitação.'
        );
      }

      const now = FieldValue.serverTimestamp();

      /**
       * Preservamos o documento como canceled, em vez de deletar.
       *
       * Motivo:
       * - facilita auditoria;
       * - evita sumiço total de eventos sociais;
       * - permite no futuro limitar spam do tipo envia/cancela/envia/cancela.
       *
       * As telas atuais consultam status == "pending",
       * então solicitações canceled deixam de aparecer normalmente.
       */
      transaction.update(requestRef, {
        status: 'canceled',
        canceledAt: now,
        respondedAt: now,
        updatedAt: now,
      });

      /**
       * Auditoria técnica separada.
       *
       * Não é para exibir ao usuário comum.
       * Serve para rastrear comportamento abusivo, suporte e debug.
       */
      transaction.set(db.collection('friendship_audit').doc(), {
        action: 'cancel-friend-request',
        requesterUid,
        targetUid,
        canceledBy: actorUid,
        requestId,
        createdAt: now,
        source: 'callable',
      });

      result = {
        requestId,
        requesterUid,
        targetUid,
        status: 'canceled',
      };
    });

    if (!result) {
      throw new HttpsError(
        'internal',
        'Não foi possível cancelar a solicitação.'
      );
    }

    return result;
  }
);