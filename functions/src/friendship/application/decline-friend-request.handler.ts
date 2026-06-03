// functions/src/friendship/application/decline-friend-request.handler.ts
// -----------------------------------------------------------------------------
// DECLINE FRIEND REQUEST HANDLER
// -----------------------------------------------------------------------------
// Recusa uma solicitação de amizade recebida de forma segura.
//
// Modelo de segurança:
//
// 1. Identidade:
//    - o usuário autenticado vem exclusivamente de request.auth.uid;
//    - o cliente informa apenas requestId;
//    - requesterUid e targetUid são lidos do próprio documento no Firestore.
//
// 2. Consentimento social:
//    - somente o destinatário da solicitação pode recusá-la;
//    - somente solicitações pending podem ser recusadas.
//
// 3. Auditoria:
//    - o documento friendRequests é preservado como "declined";
//    - registramos evento em friendship_audit;
//    - isso permite moderação, análise de abuso e suporte futuro.
//
// 4. Experiência profissional:
//    - recusar não bloqueia automaticamente;
//    - bloquear deve continuar sendo uma ação separada e explícita;
//    - isso segue o modelo de grandes plataformas: recusar contato e bloquear
//      são decisões diferentes.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

interface DeclineFriendRequestPayload {
  requestId?: unknown;
}

interface DeclineFriendRequestResponse {
  requestId: string;
  requesterUid: string;
  targetUid: string;
  status: 'declined';
}

interface FriendRequestDoc {
  requesterUid?: unknown;
  targetUid?: unknown;
  status?: unknown;
}

/**
 * Normaliza valores vindos do cliente ou do Firestore.
 *
 * Mantém as comparações previsíveis e evita operar com null/undefined.
 */
function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

export const declineFriendRequest = onCall<DeclineFriendRequestPayload>(
  {
    region: FUNCTIONS_REGION,

    /**
     * A callable pode ser chamada pelo app web/mobile,
     * mas a autorização real ocorre abaixo com request.auth.
     */
    invoker: 'public',
  },
  async (request): Promise<DeclineFriendRequestResponse> => {
    /**
     * Identidade confiável.
     * Nunca aceitar targetUid vindo do cliente para decidir permissão.
     */
    const actorUid = normalizeText(request.auth?.uid);
    const requestId = normalizeText(request.data?.requestId);

    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    /**
     * Ações sociais exigem e-mail verificado.
     *
     * Isso reduz abuso, automação de contas descartáveis e interação indevida.
     */
    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail antes de recusar solicitações.'
      );
    }

    if (!requestId) {
      throw new HttpsError('invalid-argument', 'Solicitação inválida.');
    }

    let result: DeclineFriendRequestResponse | null = null;

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
       * Só recusamos solicitação ainda pendente.
       *
       * Isso evita corrida entre aceitar, cancelar e recusar.
       */
      if (status !== 'pending') {
        throw new HttpsError(
          'failed-precondition',
          'Esta solicitação não está pendente.'
        );
      }

      /**
       * Somente o destinatário pode recusar.
       *
       * Quem enviou deve usar cancelFriendRequest.
       */
      if (actorUid !== targetUid) {
        throw new HttpsError(
          'permission-denied',
          'Somente o destinatário pode recusar esta solicitação.'
        );
      }

      const now = FieldValue.serverTimestamp();

      /**
       * Preservamos o documento como declined.
       *
       * As telas atuais consultam status == "pending",
       * então a solicitação recusada desaparece da interface normal,
       * mas continua disponível para auditoria e moderação futura.
       */
      transaction.update(requestRef, {
        status: 'declined',
        respondedAt: now,
        updatedAt: now,
      });

      /**
       * Auditoria técnica separada.
       *
       * No futuro, esse histórico pode apoiar:
       * - detecção de spam de solicitações;
       * - suporte ao usuário;
       * - moderação;
       * - métricas internas de segurança.
       */
      transaction.set(db.collection('friendship_audit').doc(), {
        action: 'decline-friend-request',
        requesterUid,
        targetUid,
        declinedBy: actorUid,
        requestId,
        createdAt: now,
        source: 'callable',
      });

      result = {
        requestId,
        requesterUid,
        targetUid,
        status: 'declined',
      };
    });

    if (!result) {
      throw new HttpsError(
        'internal',
        'Não foi possível recusar a solicitação.'
      );
    }

    return result;
  }
);