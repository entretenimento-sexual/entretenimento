// scripts/maintenance/backfill-public-age-eligibility-projection-admin.mjs
// -----------------------------------------------------------------------------
// BACKFILL DA PROJEÇÃO PÚBLICA DE ELEGIBILIDADE ETÁRIA
// -----------------------------------------------------------------------------
// Semeia ageEligibilityVerifiedAdult em superfícies públicas existentes a
// partir EXCLUSIVAMENTE de age_eligibility_records/{uid}.
//
// Segurança:
// - dry-run por padrão;
// - execução real exige AGE_PROJECTION_APPLY=true;
// - não lê idade/idade declarada/adultConsent/ageVerification como prova;
// - não altera visibility, moderationStatus, métricas ou updatedAt;
// - pagina public_profiles por documentId para limitar custo;
// - registra auditoria consolidada somente após execução efetiva.
//
// Uso PowerShell:
// $env:FIREBASE_PROJECT_ID='entretenimento-sexual'
// $env:AGE_PROJECTION_DRY_RUN='true'
// $env:AGE_PROJECTION_PAGE_SIZE='25'
// $env:AGE_PROJECTION_MAX_PROFILES='5000'
// node scripts/maintenance/backfill-public-age-eligibility-projection-admin.mjs
//
// Aplicação após revisar o dry-run:
// $env:AGE_PROJECTION_DRY_RUN='false'
// $env:AGE_PROJECTION_APPLY='true'
// node scripts/maintenance/backfill-public-age-eligibility-projection-admin.mjs
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import {
  FieldPath,
  FieldValue,
  getFirestore,
} from 'firebase-admin/firestore';

const AGE_POLICY_VERSION = 1;
const WRITE_BATCH_LIMIT = 400;

const VALID_SOURCES = new Set([
  'INITIAL_VERIFICATION',
  'AGE_REVERIFICATION',
  'PROFILE_KYC',
  'MIGRATION',
]);

const VALID_METHODS = new Set([
  'EXTERNAL_PROVIDER',
  'MANUAL_REVIEW',
  'KYC',
  'MIGRATED_REVIEW',
]);

const projectId =
  String(process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual').trim();

const dryRun =
  String(process.env.AGE_PROJECTION_DRY_RUN || 'true')
    .trim()
    .toLowerCase() !== 'false';

const apply =
  String(process.env.AGE_PROJECTION_APPLY || 'false')
    .trim()
    .toLowerCase() === 'true';

const requestedPageSize = Number.parseInt(
  String(process.env.AGE_PROJECTION_PAGE_SIZE || '25'),
  10
);

const requestedMaxProfiles = Number.parseInt(
  String(process.env.AGE_PROJECTION_MAX_PROFILES || '5000'),
  10
);

const pageSize = Number.isFinite(requestedPageSize)
  ? Math.max(1, Math.min(100, requestedPageSize))
  : 25;

const maxProfiles = Number.isFinite(requestedMaxProfiles)
  ? Math.max(1, Math.min(100_000, requestedMaxProfiles))
  : 5000;

function initializeAdmin() {
  if (getApps().length) return;

  const serviceAccountJson =
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (serviceAccountJson) {
    initializeApp({
      credential: cert(JSON.parse(serviceAccountJson)),
      projectId,
    });
    return;
  }

  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  if (value && typeof value.toMillis === 'function') {
    const parsed = value.toMillis();
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }

  return null;
}

function canonicalAgeAllowsPublicExposure(uid, raw, nowMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }

  const recordUid = String(raw.uid ?? '').trim();
  const status = String(raw.status ?? '').trim().toUpperCase();
  const source = String(raw.source ?? '').trim().toUpperCase();
  const method = String(raw.method ?? '').trim().toUpperCase();
  const policyVersion = Number(raw.policyVersion);
  const verifiedAtMs =
    toMillis(raw.verifiedAtMs) ?? toMillis(raw.verifiedAt);
  const rawExpiresAt = raw.expiresAtMs ?? raw.expiresAt ?? null;
  const expiresAtMs = rawExpiresAt === null ? null : toMillis(rawExpiresAt);

  return recordUid === uid &&
    status === 'VERIFIED_ADULT' &&
    policyVersion === AGE_POLICY_VERSION &&
    VALID_SOURCES.has(source) &&
    VALID_METHODS.has(method) &&
    verifiedAtMs !== null &&
    verifiedAtMs <= nowMs &&
    (rawExpiresAt === null || expiresAtMs !== null) &&
    (expiresAtMs === null || expiresAtMs > nowMs);
}

function statusAllowsPublicProjection(rawStatus, ageEligible, nowMs) {
  if (!ageEligible || !rawStatus || typeof rawStatus !== 'object') {
    return false;
  }

  const moderationState = String(
    rawStatus.moderation?.state ?? ''
  ).trim();
  const visibility = String(rawStatus.visibility ?? '').trim();
  const expiresAt = Number(rawStatus.expiresAt ?? 0);

  return moderationState === 'active' &&
    visibility === 'public_discovery' &&
    Number.isFinite(expiresAt) &&
    expiresAt > nowMs;
}

async function main() {
  if (!dryRun && !apply) {
    throw new Error(
      'Execução real bloqueada. Defina AGE_PROJECTION_APPLY=true.'
    );
  }

  initializeAdmin();

  const db = getFirestore();
  const runId = randomUUID();
  const nowMs = Date.now();
  let cursor = null;
  let pages = 0;
  let profilesScanned = 0;
  let profilesEligible = 0;
  let profilesIneligible = 0;
  let profileWrites = 0;
  let photoWrites = 0;
  let videoWrites = 0;
  let statusWrites = 0;
  let mediaDocumentsScanned = 0;
  let pendingWrites = 0;
  let batch = db.batch();

  const flush = async () => {
    if (dryRun || pendingWrites === 0) return;
    await batch.commit();
    batch = db.batch();
    pendingWrites = 0;
  };

  const queueProjection = async (ref, current, desired, kind) => {
    if (current === desired) return;

    if (kind === 'profile') profileWrites += 1;
    if (kind === 'photo') photoWrites += 1;
    if (kind === 'video') videoWrites += 1;
    if (kind === 'status') statusWrites += 1;

    if (dryRun) return;

    batch.set(
      ref,
      { ageEligibilityVerifiedAdult: desired },
      { merge: true }
    );
    pendingWrites += 1;

    if (pendingWrites >= WRITE_BATCH_LIMIT) {
      await flush();
    }
  };

  while (profilesScanned < maxProfiles) {
    const remaining = maxProfiles - profilesScanned;
    const currentLimit = Math.min(pageSize, remaining);

    let query = db
      .collection('public_profiles')
      .orderBy(FieldPath.documentId())
      .limit(currentLimit);

    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    pages += 1;
    cursor = snapshot.docs.at(-1);

    for (const profileDoc of snapshot.docs) {
      const uid = String(profileDoc.id ?? '').trim();
      profilesScanned += 1;

      const ageRef = db.collection('age_eligibility_records').doc(uid);
      const statusRef = db
        .collection('user_intent_statuses')
        .doc(`current_${uid}`);

      const [ageSnapshot, photosSnapshot, videosSnapshot, statusSnapshot] =
        await Promise.all([
          ageRef.get(),
          profileDoc.ref.collection('public_photos').get(),
          profileDoc.ref.collection('public_videos').get(),
          statusRef.get(),
        ]);

      const ageEligible = canonicalAgeAllowsPublicExposure(
        uid,
        ageSnapshot.exists ? ageSnapshot.data() : null,
        nowMs
      );

      if (ageEligible) profilesEligible += 1;
      else profilesIneligible += 1;

      await queueProjection(
        profileDoc.ref,
        profileDoc.data()?.ageEligibilityVerifiedAdult,
        ageEligible,
        'profile'
      );

      mediaDocumentsScanned += photosSnapshot.size + videosSnapshot.size;

      for (const photoDoc of photosSnapshot.docs) {
        await queueProjection(
          photoDoc.ref,
          photoDoc.data()?.ageEligibilityVerifiedAdult,
          ageEligible,
          'photo'
        );
      }

      for (const videoDoc of videosSnapshot.docs) {
        await queueProjection(
          videoDoc.ref,
          videoDoc.data()?.ageEligibilityVerifiedAdult,
          ageEligible,
          'video'
        );
      }

      if (statusSnapshot.exists) {
        const statusData = statusSnapshot.data() ?? {};
        const desiredStatusProjection = statusAllowsPublicProjection(
          statusData,
          ageEligible,
          nowMs
        );

        await queueProjection(
          statusSnapshot.ref,
          statusData.ageEligibilityVerifiedAdult,
          desiredStatusProjection,
          'status'
        );
      }

      console.log('[age-projection-backfill] perfil', {
        uid,
        ageEligible,
        photos: photosSnapshot.size,
        videos: videosSnapshot.size,
        dryRun,
      });
    }

    if (snapshot.size < currentLimit) break;
  }

  await flush();

  const summary = {
    runId,
    projectId,
    dryRun,
    applied: !dryRun && apply,
    policyVersion: AGE_POLICY_VERSION,
    pageSize,
    maxProfiles,
    pages,
    profilesScanned,
    profilesEligible,
    profilesIneligible,
    mediaDocumentsScanned,
    profileWrites,
    photoWrites,
    videoWrites,
    statusWrites,
    totalWrites:
      profileWrites + photoWrites + videoWrites + statusWrites,
    lastCursor: cursor?.id ?? null,
  };

  console.log('[age-projection-backfill] resumo', summary);

  if (!dryRun) {
    await db
      .collection('compliance_audit')
      .doc(`age_public_projection_backfill_${runId}`)
      .set({
        type: 'age_eligibility.public_projection_backfill',
        source: 'maintenance-script',
        ...summary,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),
      });
  }
}

main().catch((error) => {
  console.error('[age-projection-backfill] falhou', {
    code: error?.code,
    message: error?.message,
  });
  process.exitCode = 1;
});
