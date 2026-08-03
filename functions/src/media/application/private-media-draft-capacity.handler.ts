import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  calculatePrivateMediaDraftReservationBytes,
  evaluatePrivateMediaDraftCapacity,
  getPrivateMediaDraftLimit,
  resolvePrivateMediaDraftPlan,
  type PrivateMediaDraftKind,
  type PrivateMediaDraftPlan,
} from './private-media-draft.policy';
import {
  evaluatePrivateMediaDraftEligibility,
} from './private-media-draft-eligibility.policy';
import { privateMediaDraftHttpsError } from './private-media-draft-error';

interface PrivateMediaDraftCapacityRequest {
  kind?: unknown;
  sourceSizeBytes?: unknown;
  auxiliarySizeBytes?: unknown;
}

interface PrivateMediaDraftCapacityResponse {
  allowed: boolean;
  reason: 'ALLOWED' | 'ITEM_LIMIT' | 'BYTE_LIMIT';
  plan: PrivateMediaDraftPlan;
  expiresAfterMs: number;
  currentItems: number;
  currentReservedBytes: number;
  maxItems: number;
  maxReservedBytes: number;
  requestedReservedBytes: number;
}

const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_SIZE_BYTES = 500 * 1024 * 1024;
const VIDEO_POSTER_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const USAGE_COLLECTION = 'media_private_draft_usage';

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/')
  ) {
    return '';
  }

  return normalized;
}

function normalizePositiveInteger(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed));
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed));
}

function normalizeKind(value: unknown): PrivateMediaDraftKind | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'photo' || normalized === 'video'
    ? normalized
    : null;
}

function validateSizes(
  kind: PrivateMediaDraftKind,
  sourceSizeBytes: number,
  auxiliarySizeBytes: number
): void {
  const maximumSourceSize = kind === 'photo'
    ? PHOTO_MAX_SIZE_BYTES
    : VIDEO_MAX_SIZE_BYTES;

  if (!sourceSizeBytes || sourceSizeBytes > maximumSourceSize) {
    throw new HttpsError(
      'invalid-argument',
      'O arquivo excede o limite permitido ou está vazio.'
    );
  }

  if (
    kind === 'photo' && auxiliarySizeBytes > 0 ||
    auxiliarySizeBytes > VIDEO_POSTER_MAX_SIZE_BYTES
  ) {
    throw new HttpsError(
      'invalid-argument',
      'O arquivo auxiliar excede o limite permitido.'
    );
  }
}

export const getPrivateMediaDraftCapacity = onCall<
  PrivateMediaDraftCapacityRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PrivateMediaDraftCapacityResponse> => {
    const ownerUid = cleanId(request.auth?.uid);
    const kind = normalizeKind(request.data?.kind);

    if (!ownerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!kind) {
      throw new HttpsError('invalid-argument', 'Tipo de mídia inválido.');
    }

    const sourceSizeBytes = normalizePositiveInteger(
      request.data?.sourceSizeBytes
    );
    const auxiliarySizeBytes = normalizeNonNegativeInteger(
      request.data?.auxiliarySizeBytes
    );
    validateSizes(kind, sourceSizeBytes, auxiliarySizeBytes);

    const [userSnapshot, usageSnapshot] = await Promise.all([
      db.doc(`users/${ownerUid}`).get(),
      db.collection(USAGE_COLLECTION).doc(ownerUid).get(),
    ]);
    const user = userSnapshot.exists ? userSnapshot.data() : null;
    const eligibility = evaluatePrivateMediaDraftEligibility(
      user,
      ownerUid,
      request.auth?.token?.['email_verified'] === true
    );

    if (!eligibility.allowed) {
      throw privateMediaDraftHttpsError(
        'permission-denied',
        eligibility.errorCode ?? 'MEDIA_UPLOAD_NOT_ALLOWED',
        eligibility.message ?? 'A conta não está liberada para enviar mídia.',
        eligibility.recovery ?? 'Regularize a conta antes de continuar.'
      );
    }

    const now = Date.now();
    const plan = resolvePrivateMediaDraftPlan(user, now);
    const requestedReservedBytes =
      calculatePrivateMediaDraftReservationBytes(
        kind,
        sourceSizeBytes,
        auxiliarySizeBytes
      );
    const decision = evaluatePrivateMediaDraftCapacity(
      kind,
      plan,
      usageSnapshot.exists ? usageSnapshot.data() : null,
      requestedReservedBytes
    );
    const limit = getPrivateMediaDraftLimit(kind, plan);

    return {
      allowed: decision.allowed,
      reason: decision.reason,
      plan,
      expiresAfterMs: limit.retentionMs,
      currentItems: decision.currentItems,
      currentReservedBytes: decision.currentReservedBytes,
      maxItems: limit.maxItems,
      maxReservedBytes: limit.maxReservedBytes,
      requestedReservedBytes,
    };
  }
);
