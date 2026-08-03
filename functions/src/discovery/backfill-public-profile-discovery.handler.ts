// functions/src/discovery/backfill-public-profile-discovery.handler.ts
// -----------------------------------------------------------------------------
// BACKFILL PUBLIC PROFILE DISCOVERY
// -----------------------------------------------------------------------------
// Callable administrativa para preencher em public_profiles:
// - identidade normalizada e reciprocidade;
// - idade e descrição públicas;
// - intenções, práticas e características autorizadas pelo proprietário.
//
// Não é executada automaticamente. O fluxo operacional recomendado continua:
// dry-run paginado -> revisão dos totais -> execução paginada após deploy.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldPath } from 'firebase-admin/firestore';
import { FieldValue, db } from '../firebaseApp';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { hasMinimumActiveDiscoveryPlan } from './discovery-subscription-access';
import { normalizeProfileDiscoveryFields } from './profile-discovery-normalization';
import { normalizePublicProfileDescription } from './public-profile-description';
import { buildPublicPreferenceProjection } from './public-preference-projection';

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
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(500, Math.floor(value)))
    : 100;
}

function normalizeCursor(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function hasElevatedAccess(source: Record<string, unknown>): boolean {
  const roles = new Set<string>([
    ...normalizeStringArray(source['staffRoles']),
    ...normalizeStringArray(source['roles']),
  ]);
  const permissions = new Set<string>(
    normalizeStringArray(source['permissions'])
  );

  return source['superadmin'] === true
    || source['admin'] === true
    || source['moderator'] === true
    || roles.has('superadmin')
    || roles.has('admin')
    || roles.has('moderator')
    || permissions.has('discovery:backfill')
    || permissions.has('users:lifecycle');
}

async function assertBackfillAuthorization(
  actorUid: string | null,
  authToken: Record<string, unknown> | undefined
): Promise<void> {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (hasElevatedAccess(authToken ?? {})) return;

  const actorSnap = await db.collection('users').doc(actorUid).get();
  if (hasElevatedAccess((actorSnap.data() ?? {}) as Record<string, unknown>)) {
    return;
  }

  throw new HttpsError(
    'permission-denied',
    'Usuário sem permissão para executar backfill de discovery.'
  );
}

export const backfillPublicProfileDiscovery = onCall<BackfillPublicProfileDiscoveryRequest>(
  {
    region: FUNCTIONS_REGION,
    invoker: 'public',
  },
  async (request): Promise<BackfillPublicProfileDiscoveryResult> => {
    const actorUid = request.auth?.uid ?? null;
    await assertBackfillAuthorization(
      actorUid,
      (request.auth?.token ?? {}) as Record<string, unknown>
    );

    const limit = normalizeLimit(request.data?.limit);
    const dryRun = request.data?.dryRun === true;
    const startAfterUid = normalizeCursor(request.data?.startAfterUid);

    let usersQuery = db.collection('users').orderBy(FieldPath.documentId());
    if (startAfterUid) usersQuery = usersQuery.startAfter(startAfterUid);

    const usersSnap = await usersQuery.limit(limit).get();
    const batch = db.batch();

    let processed = 0;
    let updated = 0;
    let skippedWithoutPublicProfile = 0;
    let skippedWithoutUid = 0;

    for (const userDoc of usersSnap.docs) {
      const uid = String(userDoc.id ?? '').trim();
      if (!uid) {
        skippedWithoutUid += 1;
        continue;
      }

      processed += 1;

      const publicProfileRef = db.collection('public_profiles').doc(uid);
      const preferenceRef = db
        .collection('users')
        .doc(uid)
        .collection('preferences')
        .doc('profile');
      const [publicProfileSnap, preferenceSnap] = await Promise.all([
        publicProfileRef.get(),
        preferenceRef.get(),
      ]);

      if (!publicProfileSnap.exists) {
        skippedWithoutPublicProfile += 1;
        continue;
      }

      const user = (userDoc.data() ?? {}) as Record<string, unknown>;
      const canonical = normalizeProfileDiscoveryFields(user);
      const publicPreferences = buildPublicPreferenceProjection(
        preferenceSnap.exists
          ? (preferenceSnap.data() ?? {}) as Record<string, unknown>
          : null,
        {
          canPublishAdvanced: hasMinimumActiveDiscoveryPlan(user, 'basic'),
        }
      );

      updated += 1;

      if (!dryRun) {
        batch.set(
          publicProfileRef,
          {
            normalizedGender: canonical.normalizedGender,
            normalizedOrientation: canonical.normalizedOrientation,
            interestedInGenders: canonical.interestedInGenders,
            interestedInOrientations: canonical.interestedInOrientations,
            compatibilityReady: canonical.compatibilityReady,
            age: normalizePublicAge(user['idade'] ?? user['age']),
            descricao: normalizePublicProfileDescription(
              user['descricao'] ?? user['description'] ?? user['bio']
            ),
            ...publicPreferences,
            discoveryNormalizedAt: FieldValue.serverTimestamp(),
            publicPreferencesUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
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

function normalizePublicAge(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const age = Math.round(value);
  return age >= 18 && age <= 100 ? age : null;
}
