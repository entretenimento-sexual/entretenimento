import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  UserDoc,
  assertStaffAuthorization,
  buildPublicProfileSeed,
  getNicknameIndexDocId,
  normalizeNicknameForIndex,
} from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildAgeReverificationDueAt,
  calculateAgeBand,
  isProfileMinorSafetyReport,
  type ProfileAgeBand,
} from './profile-age-reverification.policy';

interface ReportProfileMinorSafetyRequest {
  targetUid?: string;
  details?: string | null;
  route?: string | null;
}

interface RequestProfileAgeReverificationRequest {
  reportId?: string;
  resolution?: string | null;
}

interface SubmitProfileAgeReverificationRequest {
  birthDate?: string;
  confirmsTruthfulness?: boolean;
  acceptsRestrictedProcessing?: boolean;
}

interface ReviewProfileAgeReverificationRequest {
  reportId?: string;
  decision?: 'VERIFY' | 'REJECT';
  resolution?: string | null;
}

interface ModerationReportDocument {
  reporterUid?: string;
  targetType?: string;
  targetId?: string;
  targetOwnerUid?: string;
  reason?: string;
  status?: string;
  ageReverificationCaseId?: string | null;
  ageReverificationStatus?: string | null;
}

interface AgeReverificationRecord {
  status?: string;
  caseId?: string | null;
  reportId?: string | null;
  dueAt?: number | null;
}

interface AgeReverificationUserDocument extends UserDoc {
  ageReverification?: AgeReverificationRecord | null;
  suspended?: boolean;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanRoute(value: unknown): string | null {
  const route = cleanText(value, 300);
  return route.startsWith('/') && !route.startsWith('//') ? route : null;
}

function activeDedupId(reporterUid: string, targetUid: string): string {
  return `profile_minor_${createHash('sha256')
    .update(`${reporterUid}:${targetUid}`)
    .digest('hex')}`;
}

function assertAuthenticatedUid(requestAuth: unknown): string {
  const auth = requestAuth as { uid?: unknown } | null | undefined;
  const uid = cleanId(auth?.uid);

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Entre novamente para continuar.');
  }

  return uid;
}

async function assertModerator(requestAuth: unknown): Promise<string> {
  const auth = requestAuth as {
    uid?: unknown;
    token?: Record<string, unknown>;
  } | null | undefined;
  const actorUid = cleanId(auth?.uid);

  await assertStaffAuthorization({
    actorUid: actorUid || null,
    authToken: auth?.token ?? {},
    requiredPermission: 'users:suspend',
  });

  return actorUid;
}

function reportTargetUid(report: ModerationReportDocument): string {
  return cleanId(report.targetOwnerUid) || cleanId(report.targetId);
}

function assertMinorProfileReport(report: ModerationReportDocument): string {
  if (!isProfileMinorSafetyReport(report)) {
    throw new HttpsError(
      'failed-precondition',
      'A revalidação só pode partir de denúncia de perfil por possível menoridade.'
    );
  }

  const targetUid = reportTargetUid(report);

  if (!targetUid) {
    throw new HttpsError('failed-precondition', 'Perfil denunciado inválido.');
  }

  return targetUid;
}

function statusOf(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export const reportProfileMinorSafety = onCall<ReportProfileMinorSafetyRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ reportId: string }> => {
    const reporterUid = assertAuthenticatedUid(request.auth);
    const targetUid = cleanId(request.data?.targetUid);
    const details = cleanText(request.data?.details, 1200);
    const route = cleanRoute(request.data?.route);

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'Perfil denunciado inválido.');
    }

    if (targetUid === reporterUid) {
      throw new HttpsError(
        'failed-precondition',
        'Não é possível denunciar o próprio perfil.'
      );
    }

    const reportRef = db.collection('moderation_reports').doc();
    const dedupRef = db
      .collection('moderation_report_dedup')
      .doc(activeDedupId(reporterUid, targetUid));
    const targetUserRef = db.collection('users').doc(targetUid);

    await db.runTransaction(async (transaction) => {
      const [targetUserSnapshot, dedupSnapshot] = await Promise.all([
        transaction.get(targetUserRef),
        transaction.get(dedupRef),
      ]);

      if (!targetUserSnapshot.exists) {
        throw new HttpsError('not-found', 'Perfil denunciado não encontrado.');
      }

      const targetUser = targetUserSnapshot.data() as AgeReverificationUserDocument;
      const accountStatus = String(targetUser.accountStatus ?? 'active').trim();

      if (accountStatus === 'deleted') {
        throw new HttpsError('not-found', 'Perfil denunciado não encontrado.');
      }

      const dedup = dedupSnapshot.data() ?? {};

      if (dedup['active'] === true) {
        throw new HttpsError(
          'already-exists',
          'Você já possui uma denúncia de possível menoridade em análise para este perfil.'
        );
      }

      const timestamp = FieldValue.serverTimestamp();

      transaction.create(reportRef, {
        reporterUid,
        targetType: 'profile',
        targetId: targetUid,
        parentTargetId: null,
        targetOwnerUid: targetUid,
        targetAuthorUid: targetUid,
        reason: 'minor_safety',
        details: details || null,
        route,
        status: 'open',
        moderationAction: null,
        ageReverificationCaseId: null,
        ageReverificationStatus: null,
        source: 'web',
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      transaction.set(dedupRef, {
        active: true,
        reportId: reportRef.id,
        reporterUid,
        targetUid,
        reason: 'minor_safety',
        updatedAt: timestamp,
      });
    });

    return { reportId: reportRef.id };
  }
);

export const requestProfileAgeReverification = onCall<
  RequestProfileAgeReverificationRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ caseId: string; status: 'REQUIRED' }> => {
    const adminUid = await assertModerator(request.auth);
    const reportId = cleanId(request.data?.reportId);
    const resolution = cleanText(request.data?.resolution, 900);

    if (!reportId || resolution.length < 8) {
      throw new HttpsError(
        'invalid-argument',
        'Informe a denúncia e uma justificativa objetiva.'
      );
    }

    const reportRef = db.collection('moderation_reports').doc(reportId);
    const caseRef = db.collection('age_reverification_cases').doc();
    const adminLogRef = db.collection('admin_logs').doc();
    const complianceAuditRef = db.collection('compliance_audit').doc();
    const requestedAt = Date.now();
    const dueAt = buildAgeReverificationDueAt(requestedAt);

    await db.runTransaction(async (transaction) => {
      const reportSnapshot = await transaction.get(reportRef);

      if (!reportSnapshot.exists) {
        throw new HttpsError('not-found', 'Denúncia não encontrada.');
      }

      const report = reportSnapshot.data() as ModerationReportDocument;
      const targetUid = assertMinorProfileReport(report);
      const reportStatus = String(report.status ?? '').trim().toLowerCase();

      if (reportStatus !== 'open' && reportStatus !== 'reviewing') {
        throw new HttpsError(
          'failed-precondition',
          'Esta denúncia já foi encerrada.'
        );
      }

      const userRef = db.collection('users').doc(targetUid);
      const publicProfileRef = db.collection('public_profiles').doc(targetUid);
      const userSnapshot = await transaction.get(userRef);

      if (!userSnapshot.exists) {
        throw new HttpsError('not-found', 'Usuário denunciado não encontrado.');
      }

      const user = userSnapshot.data() as AgeReverificationUserDocument;
      const currentStatus = statusOf(user.ageReverification?.status);

      if (
        currentStatus === 'REQUIRED' ||
        currentStatus === 'SUBMITTED' ||
        currentStatus === 'UNDER_REVIEW'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Este perfil já possui revalidação de idade em andamento.'
        );
      }

      const nicknameIndexDocId = getNicknameIndexDocId(user);
      const timestamp = FieldValue.serverTimestamp();

      transaction.set(userRef, {
        ageReverification: {
          status: 'REQUIRED',
          caseId: caseRef.id,
          reportId,
          source: 'MINOR_SAFETY_PROFILE_REPORT',
          requestedAt,
          dueAt,
          submittedAt: null,
          reviewedAt: null,
          reviewedBy: null,
          result: null,
          method: null,
          resolution: null,
        },
        publicVisibility: 'hidden',
        interactionBlocked: true,
        ageReverificationRestrictedAt: requestedAt,
        updatedAt: timestamp,
      }, { merge: true });

      transaction.delete(publicProfileRef);

      if (nicknameIndexDocId) {
        transaction.delete(db.collection('public_index').doc(nicknameIndexDocId));
      }

      transaction.create(caseRef, {
        caseId: caseRef.id,
        reportId,
        targetUid,
        status: 'REQUIRED',
        source: 'MINOR_SAFETY_PROFILE_REPORT',
        requestedAt,
        dueAt,
        requestedBy: adminUid,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      transaction.update(reportRef, {
        status: 'reviewing',
        resolution,
        reviewedBy: adminUid,
        reviewedAt: timestamp,
        ageReverificationCaseId: caseRef.id,
        ageReverificationStatus: 'REQUIRED',
        updatedAt: timestamp,
      });

      transaction.create(adminLogRef, {
        adminUid,
        action: 'profileAgeReverificationRequested',
        targetUserUid: targetUid,
        details: {
          reportId,
          caseId: caseRef.id,
          reason: 'minor_safety',
          targetType: 'profile',
          resolution,
        },
        timestamp,
      });

      transaction.create(complianceAuditRef, {
        uid: targetUid,
        type: 'age_reverification.required',
        reportId,
        caseId: caseRef.id,
        actorUid: adminUid,
        source: 'moderation',
        createdAt: timestamp,
        createdAtMs: requestedAt,
      });
    });

    return { caseId: caseRef.id, status: 'REQUIRED' };
  }
);

export const submitProfileAgeReverification = onCall<
  SubmitProfileAgeReverificationRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ caseId: string; status: 'SUBMITTED' }> => {
    const uid = assertAuthenticatedUid(request.auth);

    if (request.auth?.token?.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Confirme seu e-mail antes de enviar a revalidação.'
      );
    }

    if (
      request.data?.confirmsTruthfulness !== true ||
      request.data?.acceptsRestrictedProcessing !== true
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Confirme a veracidade dos dados e o processamento restrito.'
      );
    }

    const ageBand = calculateAgeBand(String(request.data?.birthDate ?? ''));

    if (!ageBand) {
      throw new HttpsError('invalid-argument', 'Data de nascimento inválida.');
    }

    const userRef = db.collection('users').doc(uid);
    const submittedAt = Date.now();
    let submittedCaseId = '';

    await db.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);

      if (!userSnapshot.exists) {
        throw new HttpsError('not-found', 'Conta não encontrada.');
      }

      const user = userSnapshot.data() as AgeReverificationUserDocument;
      const ageReverification = user.ageReverification ?? {};
      const currentStatus = statusOf(ageReverification.status);
      const caseId = cleanId(ageReverification.caseId);
      const reportId = cleanId(ageReverification.reportId);
      const dueAt = Number(ageReverification.dueAt ?? 0);

      if (currentStatus !== 'REQUIRED' || !caseId || !reportId) {
        throw new HttpsError(
          'failed-precondition',
          'Não há revalidação de idade pendente para esta conta.'
        );
      }

      if (Number.isFinite(dueAt) && dueAt > 0 && submittedAt > dueAt) {
        throw new HttpsError(
          'deadline-exceeded',
          'O prazo desta revalidação expirou. Entre em contato com o suporte.'
        );
      }

      const caseRef = db.collection('age_reverification_cases').doc(caseId);
      const reportRef = db.collection('moderation_reports').doc(reportId);
      const auditRef = db.collection('compliance_audit').doc();
      const [caseSnapshot, reportSnapshot] = await Promise.all([
        transaction.get(caseRef),
        transaction.get(reportRef),
      ]);

      if (!caseSnapshot.exists || !reportSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'O caso de revalidação não está disponível.'
        );
      }

      const report = reportSnapshot.data() as ModerationReportDocument;

      if (assertMinorProfileReport(report) !== uid) {
        throw new HttpsError('permission-denied', 'Caso de revalidação inválido.');
      }

      const timestamp = FieldValue.serverTimestamp();
      const result = ageBand === '18_PLUS' ? 'INCONCLUSIVE' : 'UNDERAGE';

      transaction.set(userRef, {
        ageReverification: {
          ...ageReverification,
          status: 'SUBMITTED',
          submittedAt,
          result,
          method: 'SELF_DECLARATION_REVIEW',
          declaredAgeBand: ageBand,
          resolution: null,
        },
        updatedAt: timestamp,
      }, { merge: true });

      transaction.set(caseRef, {
        status: 'SUBMITTED',
        submittedAt,
        result,
        method: 'SELF_DECLARATION_REVIEW',
        declaredAgeBand: ageBand,
        birthDateStored: false,
        updatedAt: timestamp,
      }, { merge: true });

      transaction.update(reportRef, {
        ageReverificationStatus: 'SUBMITTED',
        ageReverificationSubmittedAt: timestamp,
        updatedAt: timestamp,
      });

      transaction.create(auditRef, {
        uid,
        type: 'age_reverification.submitted',
        reportId,
        caseId,
        result,
        declaredAgeBand: ageBand,
        birthDateStored: false,
        source: 'web',
        createdAt: timestamp,
        createdAtMs: submittedAt,
      });

      submittedCaseId = caseId;
    });

    return { caseId: submittedCaseId, status: 'SUBMITTED' };
  }
);

export const reviewProfileAgeReverification = onCall<
  ReviewProfileAgeReverificationRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ reportId: string; status: 'VERIFIED' | 'REJECTED' }> => {
    const adminUid = await assertModerator(request.auth);
    const reportId = cleanId(request.data?.reportId);
    const decision = String(request.data?.decision ?? '').trim().toUpperCase();
    const resolution = cleanText(request.data?.resolution, 900);

    if (
      !reportId ||
      (decision !== 'VERIFY' && decision !== 'REJECT') ||
      resolution.length < 8
    ) {
      throw new HttpsError('invalid-argument', 'Decisão de revalidação inválida.');
    }

    const reportRef = db.collection('moderation_reports').doc(reportId);
    const reviewedAt = Date.now();
    let finalStatus: 'VERIFIED' | 'REJECTED' = decision === 'VERIFY'
      ? 'VERIFIED'
      : 'REJECTED';

    await db.runTransaction(async (transaction) => {
      const reportSnapshot = await transaction.get(reportRef);

      if (!reportSnapshot.exists) {
        throw new HttpsError('not-found', 'Denúncia não encontrada.');
      }

      const report = reportSnapshot.data() as ModerationReportDocument;
      const targetUid = assertMinorProfileReport(report);
      const caseId = cleanId(report.ageReverificationCaseId);

      if (!caseId) {
        throw new HttpsError(
          'failed-precondition',
          'A denúncia não possui caso de revalidação.'
        );
      }

      const userRef = db.collection('users').doc(targetUid);
      const caseRef = db.collection('age_reverification_cases').doc(caseId);
      const [userSnapshot, caseSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(caseRef),
      ]);

      if (!userSnapshot.exists || !caseSnapshot.exists) {
        throw new HttpsError('not-found', 'Caso de revalidação não encontrado.');
      }

      const user = userSnapshot.data() as AgeReverificationUserDocument;
      const currentStatus = statusOf(user.ageReverification?.status);

      if (currentStatus !== 'SUBMITTED' && currentStatus !== 'UNDER_REVIEW') {
        throw new HttpsError(
          'failed-precondition',
          'A revalidação ainda não foi enviada para decisão.'
        );
      }

      const timestamp = FieldValue.serverTimestamp();
      const publicProfileRef = db.collection('public_profiles').doc(targetUid);
      const nicknameIndexDocId = getNicknameIndexDocId(user);
      const dedupRef = db.collection('moderation_report_dedup').doc(
        activeDedupId(cleanId(report.reporterUid), targetUid)
      );

      if (decision === 'VERIFY') {
        const accountStatus = String(user.accountStatus ?? 'active').trim();
        const canRestoreAccess = accountStatus === 'active' && user.suspended !== true;

        transaction.set(userRef, {
          ageReverification: {
            ...user.ageReverification,
            status: 'VERIFIED',
            reviewedAt,
            reviewedBy: adminUid,
            result: 'ADULT',
            resolution,
          },
          ...(canRestoreAccess
            ? {
                publicVisibility: 'visible',
                interactionBlocked: false,
                ageReverificationRestrictedAt: null,
              }
            : {}),
          updatedAt: timestamp,
        }, { merge: true });

        if (canRestoreAccess) {
          transaction.set(
            publicProfileRef,
            buildPublicProfileSeed(user, targetUid, reviewedAt),
            { merge: true }
          );

          if (nicknameIndexDocId) {
            transaction.set(
              db.collection('public_index').doc(nicknameIndexDocId),
              {
                type: 'nickname',
                value: String(user.nicknameNormalized ?? '').trim() ||
                  normalizeNicknameForIndex(user.nickname),
                uid: targetUid,
                createdAt: reviewedAt,
                lastChangedAt: reviewedAt,
              },
              { merge: true }
            );
          }
        }
      } else {
        transaction.set(userRef, {
          ageReverification: {
            ...user.ageReverification,
            status: 'REJECTED',
            reviewedAt,
            reviewedBy: adminUid,
            result: 'UNDERAGE',
            resolution,
          },
          accountStatus: 'moderation_suspended',
          publicVisibility: 'hidden',
          interactionBlocked: true,
          loginAllowed: true,
          suspended: true,
          suspensionReason: resolution,
          suspensionSource: 'moderator',
          suspendedAtMs: reviewedAt,
          suspendedBy: adminUid,
          statusUpdatedAt: reviewedAt,
          statusUpdatedBy: adminUid,
          updatedAt: timestamp,
        }, { merge: true });

        transaction.delete(publicProfileRef);

        if (nicknameIndexDocId) {
          transaction.delete(db.collection('public_index').doc(nicknameIndexDocId));
        }
      }

      transaction.set(caseRef, {
        status: finalStatus,
        result: decision === 'VERIFY' ? 'ADULT' : 'UNDERAGE',
        reviewedAt,
        reviewedBy: adminUid,
        resolution,
        updatedAt: timestamp,
      }, { merge: true });

      transaction.update(reportRef, {
        status: 'resolved',
        moderationAction: decision === 'VERIFY' ? 'KEEP' : 'REMOVE',
        resolution,
        reviewedBy: adminUid,
        reviewedAt: timestamp,
        ageReverificationStatus: finalStatus,
        updatedAt: timestamp,
      });

      transaction.set(dedupRef, {
        active: false,
        reportId,
        reporterUid: cleanId(report.reporterUid),
        targetUid,
        reason: 'minor_safety',
        updatedAt: timestamp,
      }, { merge: true });

      transaction.create(db.collection('admin_logs').doc(), {
        adminUid,
        action: 'profileAgeReverificationReviewed',
        targetUserUid: targetUid,
        details: {
          reportId,
          caseId,
          decision,
          nextStatus: finalStatus,
          resolution,
        },
        timestamp,
      });

      transaction.create(db.collection('compliance_audit').doc(), {
        uid: targetUid,
        type: decision === 'VERIFY'
          ? 'age_reverification.verified'
          : 'age_reverification.rejected',
        reportId,
        caseId,
        actorUid: adminUid,
        result: decision === 'VERIFY' ? 'ADULT' : 'UNDERAGE',
        source: 'moderation',
        createdAt: timestamp,
        createdAtMs: reviewedAt,
      });
    });

    return { reportId, status: finalStatus };
  }
);
