// functions/src/discovery/backfill-public-profile-discovery.handler.ts
// -----------------------------------------------------------------------------
// BACKFILL PUBLIC PROFILE DISCOVERY
// -----------------------------------------------------------------------------
// Callable administrativa para preencher campos canônicos de discovery em
// public_profiles existentes.
//
// Uso previsto:
// - uma execução controlada após deploy da trigger syncPublicProfileDiscovery;
// - manutenção pontual quando surgirem novos campos canônicos;
// - não é exposta para usuários comuns.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldPath } from 'firebase-admin/firestore';
import { FieldValue, db } from '../firebaseApp';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { normalizeProfileDiscoveryFields } from './profile-discovery-normalization';

interface BackfillPublicProfileDiscoveryRequest {
  limit?: number | null;
  dryRun?: boolean | null;
  startAfterUid?: string | null;
}

interface BackfillPublicProfileDiscoveryResult {
  ok: boolean;
  dryRun: boolean;
  limit: number;
  startAfterUid: string | null;
  nextCursor: string | null;
  hasMore: boolean;
  processed: number;
  updated: number;
  skippedWithoutPublicProfile: number;
  skippedWithoutUid: number;
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 100;
  }

  return Math.max(1, Math.min(500, Math.floor(value)));
}

function normalizeCursor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const cursor = value.trim();

  return cursor.length ? cursor : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function hasElevatedAccess(source: Record<string, unknown>): boolean {
  const roles = new Set<string>([
    ...normalizeStringArray(source.staffRoles),
    ...normalizeStringArray(source.roles),
  ]);
  const permissions = new Set<string>(normalizeStringArray(source.permissions));

  if (
    source.superadmin === true ||
    source.admin === true ||
    source.moderator === true
  ) {
    return true;
  }

  return roles.has('superadmin') ||
    roles.has('admin') ||
    roles.has('moderator') ||
    permissions.has('discovery:backfill') ||
    permissions.has('users:lifecycle');
}

async function assertBackfillAuthorization(
  actorUid: string | null,
  authToken: Record<string, unknown> | undefined
): Promise<void> {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (hasElevatedAccess(authToken ?? {})) {
    return;
  }

  const actorSnap = await db.collection('users').doc(actorUid).get();
  const actorData = (actorSnap.data() ?? {}) as Record<string, unknown>;

  if (hasElevatedAccess(actorData)) {
    return;
  }

  throw new HttpsError(
    'permission-denied',
    'Usuário sem permissão para executar backfill de discovery.'
  );
}

export const backfillPublicProfileDiscovery = onCall<BackfillPublicProfileDiscoveryRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<BackfillPublicProfileDiscoveryResult> => {
    const actorUid = request.auth?.uid ?? null;
    await assertBackfillAuthorization(
      actorUid,
      (request.auth?.token ?? {}) as Record<string, unknown>
    );

    const limit = normalizeLimit(request.data?.limit);
    const dryRun = request.data?.dryRun === true;
    const startAfterUid = normalizeCursor(request.data?.startAfterUid);

    let usersQuery = db
      .collection('users')
      .orderBy(FieldPath.documentId());

    if (startAfterUid) {
      usersQuery = usersQuery.startAfter(startAfterUid);
    }

    const usersSnap = await usersQuery.limit(limit).get();

    let processed = 0;
    let updated = 0;
    let skippedWithoutPublicProfile = 0;
    let skippedWithoutUid = 0;

    const batch = db.batch();

    for (const userDoc of usersSnap.docs) {
      const uid = String(userDoc.id ?? '').trim();

      if (!uid) {
        skippedWithoutUid += 1;
        continue;
      }

      processed += 1;

      const publicProfileRef = db.collection('public_profiles').doc(uid);
      const publicProfileSnap = await publicProfileRef.get();

      if (!publicProfileSnap.exists) {
        skippedWithoutPublicProfile += 1;
        continue;
      }

      const canonical = normalizeProfileDiscoveryFields(userDoc.data() ?? {});

      updated += 1;

      if (!dryRun) {
        batch.set(publicProfileRef, {
          normalizedGender: canonical.normalizedGender,
          normalizedOrientation: canonical.normalizedOrientation,
          interestedInGenders: canonical.interestedInGenders,
          interestedInOrientations: canonical.interestedInOrientations,
          compatibilityReady: canonical.compatibilityReady,
          discoveryNormalizedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    if (!dryRun && updated > 0) {
      await batch.commit();
    }

    const lastDoc = usersSnap.docs.at(-1) ?? null;
    const nextCursor = lastDoc?.id ?? null;
    const hasMore = usersSnap.size === limit && !!nextCursor;

    console.log('[discovery] Backfill canônico executado.', {
      actorUid,
      dryRun,
      limit,
      startAfterUid,
      nextCursor,
      hasMore,
      processed,
      updated,
      skippedWithoutPublicProfile,
      skippedWithoutUid,
    });

    return {
      ok: true,
      dryRun,
      limit,
      startAfterUid,
      nextCursor,
      hasMore,
      processed,
      updated,
      skippedWithoutPublicProfile,
      skippedWithoutUid,
    };
  }
);
