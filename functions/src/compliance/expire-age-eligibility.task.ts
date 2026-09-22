// functions/src/compliance/expire-age-eligibility.task.ts
// -----------------------------------------------------------------------------
// AGE ELIGIBILITY EXPIRATION TASK
// -----------------------------------------------------------------------------
// Cada registro VERIFIED_ADULT com expiresAt finito agenda uma Cloud Task para
// sua fronteira temporal. O payload inclui a geração canônica (updatedAtMs), de
// modo que tarefas antigas são no-op depois de uma reverificação.
//
// O sweep periódico permanece apenas como recuperação operacional.
// -----------------------------------------------------------------------------

import { getFunctions } from 'firebase-admin/functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { FUNCTIONS_REGION } from '../config/functions-region';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  materializeExpiredAgeEligibility,
} from './expire-age-eligibility.service';

interface AgeEligibilityExpirationTaskPayload {
  readonly uid: string;
  readonly expiresAtMs: number;
  readonly expectedUpdatedAtMs: number;
}

function cleanUid(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function positiveTime(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function toMillis(value: unknown): number | null {
  const direct = positiveTime(value);
  if (direct !== null) return direct;

  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return positiveTime(
      (value as { toMillis: () => number }).toMillis()
    );
  }

  return null;
}

function buildTaskId(payload: AgeEligibilityExpirationTaskPayload): string {
  return [
    'age-expiry',
    payload.uid,
    payload.expectedUpdatedAtMs,
    payload.expiresAtMs,
  ].join('-');
}

function isAlreadyExistsError(error: unknown): boolean {
  const code = String(
    (error as { code?: unknown } | null | undefined)?.code ?? ''
  ).trim().toLowerCase();

  return code.includes('already-exists') ||
    code.includes('task-already-exists');
}

async function enqueueExpirationTask(
  payload: AgeEligibilityExpirationTaskPayload
): Promise<void> {
  const queue = getFunctions().taskQueue<AgeEligibilityExpirationTaskPayload>(
    `locations/${FUNCTIONS_REGION}/functions/expireAgeEligibilityAtBoundary`
  );

  try {
    await queue.enqueue(
      payload,
      {
        id: buildTaskId(payload),
        scheduleTime: new Date(
          Math.max(payload.expiresAtMs, Date.now() + 1_000)
        ),
        dispatchDeadlineSeconds: 60,
      }
    );
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return;
    }

    throw error;
  }
}

export const scheduleAgeEligibilityExpirationTask = onDocumentWritten(
  {
    document: 'age_eligibility_records/{userId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const uid = cleanUid(event.params.userId);
    const after = event.data?.after;

    if (!uid || !after?.exists) {
      return;
    }

    const rawRecord = after.data() ?? {};
    const rawStatus = String(rawRecord['status'] ?? '')
      .trim()
      .toUpperCase();

    if (rawStatus !== 'VERIFIED_ADULT') {
      return;
    }

    const expiresAtMs =
      toMillis(rawRecord['expiresAtMs']) ?? toMillis(rawRecord['expiresAt']);
    const expectedUpdatedAtMs =
      toMillis(rawRecord['updatedAtMs']) ?? toMillis(rawRecord['updatedAt']);

    if (expiresAtMs === null) {
      // Revisões manuais/migrações podem ser deliberadamente sem expiração.
      return;
    }

    if (expectedUpdatedAtMs === null) {
      console.warn('[ageEligibility] Registro sem geração temporal válida.', {
        uid,
        expiresAtMs,
      });
      return;
    }

    const decision = evaluateCanonicalAgeEligibility({
      uid,
      rawRecord,
    });

    if (
      decision.expiresAtMs !== expiresAtMs ||
      decision.source === null ||
      decision.method === null ||
      decision.policyVersion !== 1 ||
      (
        !decision.allowed &&
        decision.denialReason !== 'verification_expired'
      )
    ) {
      console.warn('[ageEligibility] Registro não agendável.', {
        uid,
        status: rawStatus,
        denialReason: decision.denialReason,
        expiresAtMs,
      });
      return;
    }

    const payload: AgeEligibilityExpirationTaskPayload = {
      uid,
      expiresAtMs,
      expectedUpdatedAtMs,
    };

    await enqueueExpirationTask(payload);

    console.log('[ageEligibility] Expiração pontual agendada.', {
      ...payload,
      alreadyDue: expiresAtMs <= Date.now(),
    });
  }
);

export const expireAgeEligibilityAtBoundary = onTaskDispatched(
  {
    region: FUNCTIONS_REGION,
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 300,
    },
    rateLimits: {
      maxConcurrentDispatches: 50,
    },
  },
  async (request) => {
    const data = (request.data ?? {}) as Partial<
      AgeEligibilityExpirationTaskPayload
    >;
    const uid = cleanUid(data.uid);
    const expiresAtMs = positiveTime(data.expiresAtMs);
    const expectedUpdatedAtMs = positiveTime(data.expectedUpdatedAtMs);

    if (!uid || expiresAtMs === null || expectedUpdatedAtMs === null) {
      console.warn('[ageEligibility] Task de expiração inválida ignorada.', {
        hasUid: !!uid,
        expiresAtMs,
        expectedUpdatedAtMs,
      });
      return;
    }

    const nowMs = Date.now();
    const result = await materializeExpiredAgeEligibility(
      uid,
      nowMs,
      {
        expectedExpiresAtMs: expiresAtMs,
        expectedUpdatedAtMs,
      }
    );

    if (result.reason === 'not-due') {
      throw new Error(
        `Expiração de maioridade despachada antes da hora para ${uid}.`
      );
    }

    console.log('[ageEligibility] Task de expiração processada.', {
      uid,
      expiresAtMs,
      expectedUpdatedAtMs,
      nowMs,
      ...result,
    });
  }
);
