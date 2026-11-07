// functions/src/discovery/backfill-public-profile-discovery.handler.ts
// -----------------------------------------------------------------------------
// BACKFILL PUBLIC PROFILE DISCOVERY
// -----------------------------------------------------------------------------
// Callable administrativa para preencher em users/public_profiles:
// - profileId público canônico, opaco e separado do Firebase Auth UID;
// - identidade normalizada; interesses privados não integram a projeção pública;
// - avatar público canônico;
// - idade social declarada, sanitizada e separada da elegibilidade adulta;
// - intenções, práticas e características autorizadas pelo proprietário;
// - localização pública derivada da posição privada com redução de precisão.
//
// Não é executada automaticamente. O fluxo operacional recomendado continua:
// dry-run paginado -> revisão dos totais -> execução paginada após deploy.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../firebaseApp';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { normalizePublicProfileId } from '../identity/public-profile-id';
import { mustHoldLegacyPublicProfileMutation } from './legacy-public-profile-preservation.policy';

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
  profileIdsAssigned: number;
  skippedWithoutPublicProfile: number;
  skippedUnsafeLegacyProfile: number;
  skippedWithoutUid: number;
}

function normalizeLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(500, Math.floor(value)))
    : 100;
}

/** A ausência do parâmetro nunca autoriza escrita administrativa. */
export function normalizeBackfillDryRun(_value: unknown): boolean {
  return true;
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

    // Reject attempted writes instead of silently claiming a successful backfill.
    if (request.data?.dryRun === false) {
      throw new HttpsError('failed-precondition', 'Backfill legado de discovery disponivel apenas em dry-run.');
    }
    const limit = normalizeLimit(request.data?.limit);
    // Segurança também no callable, não só no runner administrativo:
    // payload ausente, inválido ou legado jamais autoriza escrita.
    const dryRun = normalizeBackfillDryRun(request.data?.dryRun);
    const startAfterUid = normalizeCursor(request.data?.startAfterUid);

    let usersQuery = db.collection('users').orderBy(FieldPath.documentId());
    if (startAfterUid) usersQuery = usersQuery.startAfter(startAfterUid);

    const usersSnap = await usersQuery.limit(limit).get();
    let processed = 0;
    let updated = 0;
    let profileIdsAssigned = 0;
    let skippedWithoutPublicProfile = 0;
    let skippedUnsafeLegacyProfile = 0;
    let skippedWithoutUid = 0;

    for (const userDoc of usersSnap.docs) {
      const uid = String(userDoc.id ?? '').trim();
      if (!uid) {
        skippedWithoutUid += 1;
        continue;
      }

      processed += 1;

      const user = (userDoc.data() ?? {}) as Record<string, unknown>;
      if (!normalizePublicProfileId(user['profileId'])) {
        profileIdsAssigned += 1;
      }

      const publicProfileRef = db.collection('public_profiles').doc(uid);
      const publicProfileSnap = await publicProfileRef.get();

      if (!publicProfileSnap.exists) {
        skippedWithoutPublicProfile += 1;
        continue;
      }
      if (mustHoldLegacyPublicProfileMutation(user, publicProfileSnap.data())) {
        skippedUnsafeLegacyProfile += 1;
        continue;
      }

      // Read-only inventory; normal publication remains with the guarded triggers.
      updated += 1;
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
      profileIdsAssigned,
      skippedWithoutPublicProfile,
      skippedUnsafeLegacyProfile,
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
      profileIdsAssigned,
      skippedWithoutPublicProfile,
      skippedUnsafeLegacyProfile,
      skippedWithoutUid,
    };
  }
);

