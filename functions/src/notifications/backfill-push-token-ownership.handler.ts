// functions/src/notifications/backfill-push-token-ownership.handler.ts
// -----------------------------------------------------------------------------
// BACKFILL CONTROLADO DA AUTORIDADE GLOBAL DE TOKENS FCM
// -----------------------------------------------------------------------------
// Migra somente registros users/*/push_devices/* que ainda possuem evidência
// de instalação ativa. Não tenta canonizar user.fcmToken legado isolado porque
// esse campo não prova qual instalação/conta ainda controla o token.
//
// Operação deliberadamente manual: dry-run paginado -> revisão -> escrita com
// confirmação explícita no runner administrativo. Nenhum cron é criado.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildPushTokenDocumentId,
  PUSH_TOKEN_OWNERS_COLLECTION,
} from './push-device.policy';
import {
  buildPushTokenOwnershipBackfillOwner,
  decidePushTokenOwnershipBackfill,
  resolvePushTokenOwnershipBackfillCandidate,
  type PushTokenOwnershipBackfillDecision,
  type PushTokenOwnershipBackfillOwnerCandidate,
} from './push-token-ownership-backfill.policy';

interface BackfillPushTokenOwnershipRequest {
  limit?: number | null;
  dryRun?: boolean | null;
  startAfterPath?: string | null;
}

interface BackfillPushTokenOwnershipResult {
  ok: true;
  dryRun: boolean;
  limit: number;
  startAfterPath: string | null;
  nextCursor: string | null;
  hasMore: boolean;
  processed: number;
  eligible: number;
  claimCandidates: number;
  replacementCandidates: number;
  written: number;
  skippedCanonicalOwner: number;
  skippedMalformedOwner: number;
  skippedOlderOrEqual: number;
  skippedInvalidPath: number;
  skippedInvalidToken: number;
  skippedInvalidLastSeen: number;
  skippedStale: number;
}

interface SimulatedOwnerState {
  exists: boolean;
  data?: PushTokenOwnershipBackfillOwnerCandidate;
}

const DEFAULT_BACKFILL_LIMIT = 50;
const MAX_BACKFILL_LIMIT = 100;

function normalizeLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_BACKFILL_LIMIT, Math.floor(value)))
    : DEFAULT_BACKFILL_LIMIT;
}

function normalizeCursor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cursor = value.trim();
  return cursor.length ? cursor : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item ?? '').trim().toLowerCase())
    .filter(Boolean);
}

function hasPushOwnershipBackfillAccess(
  source: Record<string, unknown>
): boolean {
  const roles = new Set<string>([
    ...normalizeStringArray(source['staffRoles']),
    ...normalizeStringArray(source['roles']),
  ]);
  const permissions = new Set<string>(
    normalizeStringArray(source['permissions'])
  );

  return (
    source['superadmin'] === true ||
    source['admin'] === true ||
    roles.has('superadmin') ||
    roles.has('admin') ||
    permissions.has('notifications:backfill') ||
    permissions.has('security:backfill')
  );
}

async function assertBackfillAuthorization(
  actorUid: string | null,
  authToken: Record<string, unknown> | undefined
): Promise<void> {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (hasPushOwnershipBackfillAccess(authToken ?? {})) return;

  const actorSnapshot = await db.collection('users').doc(actorUid).get();
  if (
    hasPushOwnershipBackfillAccess(
      (actorSnapshot.data() ?? {}) as Record<string, unknown>
    )
  ) {
    return;
  }

  throw new HttpsError(
    'permission-denied',
    'Usuário sem permissão para reconciliar ownership de push.'
  );
}

export const backfillPushTokenOwnership =
  onCall<BackfillPushTokenOwnershipRequest>(
    {
      region: FUNCTIONS_REGION,
      invoker: 'public',
      timeoutSeconds: 120,
    },
    async (request): Promise<BackfillPushTokenOwnershipResult> => {
      const actorUid = request.auth?.uid ?? null;
      await assertBackfillAuthorization(
        actorUid,
        (request.auth?.token ?? {}) as Record<string, unknown>
      );

      const limit = normalizeLimit(request.data?.limit);
      const dryRun = request.data?.dryRun !== false;
      const startAfterPath = normalizeCursor(request.data?.startAfterPath);
      const observedAtMs = Date.now();

      let devicesQuery = db
        .collectionGroup('push_devices')
        .orderBy(FieldPath.documentId());

      if (startAfterPath) {
        devicesQuery = devicesQuery.startAfter(startAfterPath);
      }

      const devicesSnapshot = await devicesQuery.limit(limit).get();
      const simulatedOwners = new Map<string, SimulatedOwnerState>();

      let eligible = 0;
      let claimCandidates = 0;
      let replacementCandidates = 0;
      let written = 0;
      let skippedCanonicalOwner = 0;
      let skippedMalformedOwner = 0;
      let skippedOlderOrEqual = 0;
      let skippedInvalidPath = 0;
      let skippedInvalidToken = 0;
      let skippedInvalidLastSeen = 0;
      let skippedStale = 0;

      const countDecision = (
        decision: PushTokenOwnershipBackfillDecision
      ): void => {
        if (decision.action === 'claim') {
          claimCandidates += 1;
          return;
        }

        if (decision.action === 'replace') {
          replacementCandidates += 1;
          return;
        }

        switch (decision.reason) {
        case 'canonical_owner_present':
          skippedCanonicalOwner += 1;
          break;
        case 'malformed_owner':
          skippedMalformedOwner += 1;
          break;
        case 'older_or_equal_backfill_candidate':
          skippedOlderOrEqual += 1;
          break;
        }
      };

      for (const deviceSnapshot of devicesSnapshot.docs) {
        const resolution = resolvePushTokenOwnershipBackfillCandidate(
          deviceSnapshot.ref.path,
          (deviceSnapshot.data() ?? {}) as Record<string, unknown>,
          observedAtMs
        );

        if (!resolution.candidate) {
          switch (resolution.reason) {
          case 'invalid_path':
            skippedInvalidPath += 1;
            break;
          case 'invalid_token':
            skippedInvalidToken += 1;
            break;
          case 'invalid_last_seen':
            skippedInvalidLastSeen += 1;
            break;
          case 'stale':
            skippedStale += 1;
            break;
          }
          continue;
        }

        eligible += 1;
        const candidate = resolution.candidate;
        const tokenOwnerId = buildPushTokenDocumentId(candidate.token);
        const tokenOwnerRef = db
          .collection(PUSH_TOKEN_OWNERS_COLLECTION)
          .doc(tokenOwnerId);

        if (dryRun) {
          let simulatedOwner = simulatedOwners.get(tokenOwnerId);

          if (!simulatedOwner) {
            const ownerSnapshot = await tokenOwnerRef.get();
            simulatedOwner = {
              exists: ownerSnapshot.exists,
              data: ownerSnapshot.exists
                ? (ownerSnapshot.data() as PushTokenOwnershipBackfillOwnerCandidate)
                : undefined,
            };
            simulatedOwners.set(tokenOwnerId, simulatedOwner);
          }

          const decision = decidePushTokenOwnershipBackfill(
            simulatedOwner.exists,
            simulatedOwner.data,
            candidate
          );
          countDecision(decision);

          if (decision.action !== 'skip') {
            simulatedOwners.set(tokenOwnerId, {
              exists: true,
              data: buildPushTokenOwnershipBackfillOwner(candidate),
            });
          }
          continue;
        }

        const decision = await db.runTransaction(async (transaction) => {
          const ownerSnapshot = await transaction.get(tokenOwnerRef);
          const nextDecision = decidePushTokenOwnershipBackfill(
            ownerSnapshot.exists,
            ownerSnapshot.exists
              ? (ownerSnapshot.data() as PushTokenOwnershipBackfillOwnerCandidate)
              : undefined,
            candidate
          );

          if (nextDecision.action !== 'skip') {
            transaction.set(tokenOwnerRef, {
              ...buildPushTokenOwnershipBackfillOwner(candidate),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          return nextDecision;
        });

        countDecision(decision);
        if (decision.action !== 'skip') {
          written += 1;
        }
      }

      const lastDevice = devicesSnapshot.docs.at(-1) ?? null;
      const nextCursor = lastDevice?.ref.path ?? null;
      const hasMore = devicesSnapshot.size === limit && Boolean(nextCursor);

      const result: BackfillPushTokenOwnershipResult = {
        ok: true,
        dryRun,
        limit,
        startAfterPath,
        nextCursor,
        hasMore,
        processed: devicesSnapshot.size,
        eligible,
        claimCandidates,
        replacementCandidates,
        written,
        skippedCanonicalOwner,
        skippedMalformedOwner,
        skippedOlderOrEqual,
        skippedInvalidPath,
        skippedInvalidToken,
        skippedInvalidLastSeen,
        skippedStale,
      };

      console.log('[push] Backfill de ownership FCM executado.', {
        actorUid,
        ...result,
      });

      return result;
    }
  );
