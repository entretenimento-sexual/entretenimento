import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { normalizeComplianceText } from './compliance-case.shared';

interface SubmitComplianceCaseResponseRequest {
  caseId: string;
  response: string;
}

const RESPONSE_DEADLINE_MESSAGE = [
  'O prazo indicado para manifestação terminou.',
  'Use o canal de atendimento para solicitar análise excepcional.',
].join(' ');

export const submitComplianceCaseResponse = onCall<
  SubmitComplianceCaseResponseRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{
    ok: true;
    caseId: string;
    status: 'USER_RESPONDED';
    respondedAtMs: number;
  }> => {
    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Faça login para responder ao caso de conformidade.'
      );
    }

    const caseId = String(request.data?.caseId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{10,120}$/.test(caseId)) {
      throw new HttpsError('invalid-argument', 'Caso de conformidade inválido.');
    }

    const response = normalizeComplianceText(
      request.data?.response,
      'Manifestação',
      20,
      4000
    );
    const respondedAtMs = Date.now();
    const caseRef = db.collection('compliance_cases').doc(caseId);
    const auditRef = db.collection('compliance_audit').doc();
    const notificationRef = db
      .collection('notifications')
      .doc(`compliance_response_received_${uid}_${caseId}`);

    await db.runTransaction(async (tx) => {
      const caseSnap = await tx.get(caseRef);
      if (!caseSnap.exists) {
        throw new HttpsError('not-found', 'Caso de conformidade não encontrado.');
      }

      const data = caseSnap.data() ?? {};
      if (String(data.targetUid ?? '').trim() !== uid) {
        throw new HttpsError(
          'permission-denied',
          'Este caso não pertence à conta autenticada.'
        );
      }

      const status = String(data.status ?? '').trim();
      if (status !== 'AWAITING_USER_RESPONSE') {
        throw new HttpsError(
          'failed-precondition',
          'Este caso não está aguardando nova manifestação.'
        );
      }

      const responseDueAt = Number(data.responseDueAt ?? 0);
      if (
        Number.isFinite(responseDueAt) &&
        responseDueAt > 0 &&
        respondedAtMs > responseDueAt
      ) {
        throw new HttpsError(
          'deadline-exceeded',
          RESPONSE_DEADLINE_MESSAGE
        );
      }

      const now = FieldValue.serverTimestamp();
      const route = [
        '/conta/conformidade?caseId=',
        encodeURIComponent(caseId),
      ].join('');

      tx.update(caseRef, {
        userResponse: response,
        userRespondedAt: now,
        status: 'USER_RESPONDED',
        updatedAt: now,
      });

      tx.create(auditRef, {
        uid,
        actorUid: uid,
        type: 'compliance.user_response_submitted',
        caseId,
        createdAt: now,
      });

      tx.set(
        notificationRef,
        {
          userId: uid,
          type: 'compliance.violation.response_received',
          title: 'Manifestação recebida',
          body:
            'Sua manifestação foi registrada e será considerada na análise do caso.',
          route,
          caseId,
          actionRequired: false,
          readAt: null,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    });

    return {
      ok: true,
      caseId,
      status: 'USER_RESPONDED',
      respondedAtMs,
    };
  }
);
