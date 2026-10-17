import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import { consumeBackendRateLimitQuota } from '../../shared/security/backend-rate-limit.service';
import {
  recheckReviewedTerminalTemporaryCleanup,
  terminalCleanupReviewBlocker,
  TerminalCleanupReviewPreconditionError,
  type TerminalCleanupQueue,
} from './video-terminal-temporary-cleanup.firestore';
import { VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION } from './video-terminal-temporary-cleanup.policy';

interface CleanupReviewItem {
  queueId: string;
  processingVersion: string;
  attempts: number;
  updatedAt: number;
  ageMs: number;
  failureCode: string | null;
  recheckable: boolean;
  blocker: string | null;
}
interface CleanupReviewList {
  checkedAt: number;
  totalReview: number;
  samplePartial: boolean;
  items: CleanupReviewItem[];
}
interface CleanupReviewCommand {
  queueId?: string;
  processingVersion?: string;
  expectedUpdatedAt?: number;
  operationId?: string;
  reason?: string;
}
const RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000, burstMax: 10,
  sustainedWindowMs: 10 * 60_000, sustainedMax: 30,
});

function adminUid(auth: unknown): string {
  const data = auth as { uid?: unknown; token?: Record<string, unknown> } | null;
  const uid = String(data?.uid ?? '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }
  const token = data?.token ?? {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  if (token['admin'] !== true && token['role'] !== 'admin' && !roles.includes('admin')) {
    throw new HttpsError('permission-denied', 'Acesso exclusivo à administração.');
  }
  return uid;
}

function safeFailureCode(error: string | null): string | null {
  return String(error ?? '').match(/^[A-Z][A-Z0-9_]{2,79}/)?.[0] ?? null;
}

export const listVideoTerminalTemporaryCleanupReviews = onCall<{ limit?: number }>(
  { region: FUNCTIONS_REGION, enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK },
  async (request): Promise<CleanupReviewList> => {
    assertCallableAppCheck(request.app);
    const uid = adminUid(request.auth);
    await consumeBackendRateLimitQuota({
      action: 'admin-video-terminal-cleanup-list',
      subject: uid, config: RATE_LIMIT,
      message: 'Limite de consultas da limpeza terminal atingido.',
    });
    const value = Number(request.data?.limit ?? 30);
    const limit = Number.isFinite(value) ? Math.max(1, Math.min(50, Math.trunc(value))) : 30;
    const checkedAt = Date.now();
    const query = db.collection(VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION)
      .where('state', '==', 'review');
    const [sample, count] = await Promise.all([
      query.limit(limit).get(), query.count().get(),
    ]);
    const items: CleanupReviewItem[] = sample.docs.map(doc => {
      const queue = doc.data() as TerminalCleanupQueue;
      const blocker = terminalCleanupReviewBlocker(doc.id, queue);
      const updatedAt = Number.isSafeInteger(queue.updatedAt) && queue.updatedAt > 0
        ? queue.updatedAt : 0;
      return {
        queueId: doc.id,
        processingVersion: String(queue.processingVersion ?? '').slice(0, 160),
        attempts: Number.isSafeInteger(queue.attempts) && queue.attempts >= 0
          ? queue.attempts : 0,
        updatedAt,
        ageMs: updatedAt > 0 ? Math.max(0, checkedAt - updatedAt) : 0,
        failureCode: safeFailureCode(queue.lastError),
        recheckable: blocker === null,
        blocker,
      };
    });
    const totalReview = count.data().count;
    return { checkedAt, totalReview, samplePartial: totalReview > items.length, items };
  }
);

export const recheckVideoTerminalTemporaryCleanup = onCall<CleanupReviewCommand>(
  { region: FUNCTIONS_REGION, enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK },
  async request => {
    assertCallableAppCheck(request.app);
    const uid = adminUid(request.auth);
    const queueId = String(request.data?.queueId ?? '');
    const processingVersion = String(request.data?.processingVersion ?? '');
    const operationId = String(request.data?.operationId ?? '');
    const expectedUpdatedAt = request.data?.expectedUpdatedAt;
    const reason = String(request.data?.reason ?? '').trim().slice(0, 900);
    if (!/^[a-f0-9]{64}$/.test(queueId) ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(processingVersion) ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(operationId) ||
        !Number.isSafeInteger(expectedUpdatedAt) ||
        Number(expectedUpdatedAt) <= 0 || reason.length < 8) {
      throw new HttpsError('invalid-argument', 'Reconferência terminal inválida.');
    }
    await consumeBackendRateLimitQuota({
      action: 'admin-video-terminal-cleanup-recheck',
      subject: uid, config: RATE_LIMIT,
      message: 'Limite de reconferências terminais atingido.',
    });
    const queueRef = db.collection(VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION).doc(queueId);
    const auditRef = db.collection('admin_logs').doc();
    try {
      const result = await recheckReviewedTerminalTemporaryCleanup(
        db, queueRef, auditRef, {
          queueId, processingVersion, expectedUpdatedAt: Number(expectedUpdatedAt),
          operationId, adminUid: uid, reason, now: Date.now(),
        }
      );
      // The existing generation-fenced scheduler performs all GCS operations.
      return { ...result, queueId, scheduled: true };
    } catch (error) {
      if (error instanceof TerminalCleanupReviewPreconditionError) {
        throw new HttpsError('failed-precondition',
          'A revisão mudou ou faltam provas para reconferir a limpeza terminal.');
      }
      logger.error('[videoTempCleanup] Falha ao agendar reconferência administrativa.', {
        category: 'ADMIN_RECHECK_FAILED',
      });
      throw new HttpsError('internal', 'Não foi possível agendar a reconferência terminal.');
    }
  }
);
