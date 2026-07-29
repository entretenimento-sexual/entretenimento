import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertRecentAuthentication,
  assertStaffAuthorization,
} from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  normalizeComplianceCategory,
  normalizeComplianceText,
  normalizeResponseDueAt,
} from './compliance-case.shared';

interface IssueSuspectedViolationNoticeRequest {
  targetUid: string;
  category: string;
  summary: string;
  policySection: string;
  responseDueAt?: number | null;
  preventiveMeasure?: string | null;
}

const SUSPECTED_VIOLATION_NOTICE_BODY = [
  'Identificamos uma possível violação que ainda está em análise.',
  'Consulte o caso e apresente sua manifestação dentro do prazo informado.',
].join(' ');

export const issueSuspectedViolationNotice = onCall<
  IssueSuspectedViolationNoticeRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{
    ok: true;
    caseId: string;
    status: 'AWAITING_USER_RESPONSE';
    responseDueAt: number;
  }> => {
    const actorUid = String(request.auth?.uid ?? '').trim();
    const authToken = (request.auth?.token ?? {}) as Record<string, unknown>;

    assertRecentAuthentication(authToken);
    await assertStaffAuthorization({
      actorUid: actorUid || null,
      authToken,
      requiredPermission: 'users:suspend',
    });

    const targetUid = String(request.data?.targetUid ?? '').trim();
    if (!targetUid || targetUid === actorUid) {
      throw new HttpsError(
        'invalid-argument',
        'Usuário alvo inválido para a notificação de conformidade.'
      );
    }

    const category = normalizeComplianceCategory(request.data?.category);
    const summary = normalizeComplianceText(
      request.data?.summary,
      'Resumo da suspeita',
      20,
      1200
    );
    const policySection = normalizeComplianceText(
      request.data?.policySection,
      'Cláusula relacionada',
      3,
      160
    );
    const preventiveMeasure = request.data?.preventiveMeasure == null
      ? null
      : normalizeComplianceText(
        request.data.preventiveMeasure,
        'Medida preventiva',
        3,
        300
      );
    const nowMs = Date.now();
    const responseDueAt = normalizeResponseDueAt(
      request.data?.responseDueAt,
      nowMs
    );

    const targetRef = db.collection('users').doc(targetUid);
    const caseRef = db.collection('compliance_cases').doc();
    const notificationRef = db
      .collection('notifications')
      .doc(`compliance_suspected_${targetUid}_${caseRef.id}`);
    const auditRef = db.collection('compliance_audit').doc();

    await db.runTransaction(async (tx) => {
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists) {
        throw new HttpsError('not-found', 'Usuário alvo não encontrado.');
      }

      const now = FieldValue.serverTimestamp();
      const route = [
        '/conta/conformidade?caseId=',
        encodeURIComponent(caseRef.id),
      ].join('');

      tx.create(caseRef, {
        caseId: caseRef.id,
        targetUid,
        openedBy: actorUid,
        category,
        summary,
        policySection,
        preventiveMeasure,
        status: 'AWAITING_USER_RESPONSE',
        presumption: 'SUSPECTED_NOT_CONFIRMED',
        responseDueAt,
        userResponse: null,
        userRespondedAt: null,
        resolution: null,
        resolvedAt: null,
        resolvedBy: null,
        createdAt: now,
        updatedAt: now,
      });

      tx.create(notificationRef, {
        userId: targetUid,
        type: 'compliance.violation.suspected',
        title: 'Aviso de possível violação',
        body: SUSPECTED_VIOLATION_NOTICE_BODY,
        route,
        caseId: caseRef.id,
        actionRequired: true,
        responseDueAt,
        policySection,
        readAt: null,
        createdAt: now,
        updatedAt: now,
      });

      tx.create(auditRef, {
        uid: targetUid,
        actorUid,
        type: 'compliance.suspected_violation_notice_issued',
        caseId: caseRef.id,
        category,
        policySection,
        responseDueAt,
        createdAt: now,
      });
    });

    return {
      ok: true,
      caseId: caseRef.id,
      status: 'AWAITING_USER_RESPONSE',
      responseDueAt,
    };
  }
);
