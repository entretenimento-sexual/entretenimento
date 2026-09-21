// functions/src/business-official/manage-business-official-entitlement.handler.ts
// -----------------------------------------------------------------------------
// MANAGE BUSINESS / OFFICIAL ENTITLEMENT
// -----------------------------------------------------------------------------
// Único writer operacional do entitlement Business/Official.
//
// Este fluxo não cria autoridade e não altera community_official_associations.
// Ele somente concede/revoga capacidades efetivas depois de autenticação
// administrativa forte. Oferta, preço e plano permanecem fora do entitlement.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  buildBusinessOfficialEntitlementDocument,
  buildBusinessOfficialEntitlementId,
  evaluateBusinessOfficialEntitlement,
  type BusinessOfficialCapabilities,
  type BusinessOfficialEntitlementSubjectType,
} from './business-official-entitlement.policy';

type BusinessOfficialEntitlementAction = 'grant' | 'revoke';

interface ManageBusinessOfficialEntitlementRequest {
  operationId?: unknown;
  action?: unknown;
  subjectType?: unknown;
  subjectId?: unknown;
  capabilities?: unknown;
  endsAt?: unknown;
  reason?: unknown;
}

interface ManageBusinessOfficialEntitlementResponse {
  entitlementId: string;
  subjectType: BusinessOfficialEntitlementSubjectType;
  subjectId: string;
  active: boolean;
  applied: boolean;
  updatedAt: number;
}

interface NormalizedCommand {
  operationId: string;
  action: BusinessOfficialEntitlementAction;
  subjectType: BusinessOfficialEntitlementSubjectType;
  subjectId: string;
  capabilities: BusinessOfficialCapabilities | null;
  endsAt: number | null;
  reason: string;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_OPERATION_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanOperationId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_OPERATION_ID_PATTERN.test(normalized) ? normalized : null;
}

function assertAdmin(auth: unknown): string {
  const authData = auth as {
    uid?: unknown;
    token?: Record<string, unknown>;
  } | null | undefined;
  const adminUid = cleanId(authData?.uid);
  const token = authData?.token ?? {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  const allowed =
    token['admin'] === true
    || token['role'] === 'admin'
    || roles.includes('admin');

  if (!adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      'Apenas administradores podem alterar entitlement Business/Official.'
    );
  }

  return adminUid;
}

function normalizeCapabilities(
  raw: unknown,
  subjectType: BusinessOfficialEntitlementSubjectType,
  subjectId: string,
  now: number,
  endsAt: number | null
): BusinessOfficialCapabilities | null {
  const decision = evaluateBusinessOfficialEntitlement({
    expectedSubjectType: subjectType,
    expectedSubjectId: subjectId,
    rawEntitlement: {
      scope: 'business_official',
      policyVersion: 1,
      subjectType,
      subjectId,
      capabilities: raw,
      active: true,
      startsAt: now,
      endsAt,
    },
    now,
  });

  return decision.allowed ? decision.capabilities : null;
}

function normalizeCommand(
  raw: ManageBusinessOfficialEntitlementRequest,
  now: number
): NormalizedCommand | null {
  const operationId = cleanOperationId(raw.operationId);
  const action = raw.action === 'grant' || raw.action === 'revoke'
    ? raw.action
    : null;
  const subjectType =
    raw.subjectType === 'user' || raw.subjectType === 'organization'
      ? raw.subjectType
      : null;
  const subjectId = cleanId(raw.subjectId);
  const reason = String(raw.reason ?? '').trim().slice(0, 500);

  if (
    !operationId
    || !action
    || !subjectType
    || !subjectId
    || reason.length < 8
  ) {
    return null;
  }

  if (action === 'revoke') {
    return {
      operationId,
      action,
      subjectType,
      subjectId,
      capabilities: null,
      endsAt: null,
      reason,
    };
  }

  const rawEndsAt = raw.endsAt;
  const endsAt = rawEndsAt === null || rawEndsAt === undefined
    ? null
    : typeof rawEndsAt === 'number'
      && Number.isFinite(rawEndsAt)
      && Math.trunc(rawEndsAt) > now
      ? Math.trunc(rawEndsAt)
      : Number.NaN;

  if (Number.isNaN(endsAt)) return null;

  const capabilities = normalizeCapabilities(
    raw.capabilities,
    subjectType,
    subjectId,
    now,
    endsAt
  );
  if (!capabilities) return null;

  return {
    operationId,
    action,
    subjectType,
    subjectId,
    capabilities,
    endsAt,
    reason,
  };
}

function normalizeCreatedAt(value: unknown, fallback: number): number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value > 0
    && value <= fallback
    ? Math.trunc(value)
    : fallback;
}

export const manageBusinessOfficialEntitlement =
  onCall<ManageBusinessOfficialEntitlementRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
    },
    async (request): Promise<ManageBusinessOfficialEntitlementResponse> => {
      assertCallableAppCheck(request.app);
      const adminUid = assertAdmin(request.auth);
      assertRecentAuthentication(
        request.auth?.token as Record<string, unknown> | undefined
      );
      const now = Date.now();
      const command = normalizeCommand(request.data ?? {}, now);

      if (!command) {
        throw new HttpsError(
          'invalid-argument',
          'Revise o sujeito, a ação, as capacidades e a justificativa.'
        );
      }

      const entitlementId = buildBusinessOfficialEntitlementId(command);
      if (!entitlementId) {
        throw new HttpsError(
          'invalid-argument',
          'Não foi possível identificar o entitlement Business/Official.'
        );
      }

      const entitlementRef = db.collection('entitlements').doc(entitlementId);
      const requestRef = db
        .collection('business_official_entitlement_requests')
        .doc(`${adminUid}:${command.operationId}`);
      const auditRef = db
        .collection('business_official_entitlement_audit')
        .doc(`${adminUid}:${command.operationId}`);

      return db.runTransaction(async (transaction) => {
        const [requestSnapshot, entitlementSnapshot] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(entitlementRef),
        ]);

        if (requestSnapshot.exists) {
          const existing = requestSnapshot.data() ?? {};
          if (
            existing['entitlementId'] !== entitlementId
            || existing['action'] !== command.action
          ) {
            throw new HttpsError(
              'already-exists',
              'O operationId já foi utilizado para outra alteração.'
            );
          }

          return {
            entitlementId,
            subjectType: command.subjectType,
            subjectId: command.subjectId,
            active: existing['active'] === true,
            applied: false,
            updatedAt: typeof existing['updatedAt'] === 'number'
              ? existing['updatedAt']
              : now,
          };
        }

        const previous = entitlementSnapshot.exists
          ? entitlementSnapshot.data() ?? {}
          : null;
        let next: Readonly<Record<string, unknown>>;

        if (command.action === 'grant') {
          if (!command.capabilities) {
            throw new HttpsError(
              'invalid-argument',
              'Capacidades Business/Official ausentes.'
            );
          }

          const built = buildBusinessOfficialEntitlementDocument({
            subjectType: command.subjectType,
            subjectId: command.subjectId,
            capabilities: command.capabilities,
            startsAt: now,
            endsAt: command.endsAt,
            createdAt: normalizeCreatedAt(previous?.['createdAt'], now),
            updatedAt: now,
            updatedBy: adminUid,
          });

          if (!built) {
            throw new HttpsError(
              'invalid-argument',
              'Entitlement Business/Official inconsistente.'
            );
          }
          next = built;
        } else {
          if (!previous) {
            throw new HttpsError(
              'not-found',
              'Entitlement Business/Official não localizado.'
            );
          }

          next = Object.freeze({
            ...previous,
            active: false,
            endsAt: now,
            revokedAt: now,
            revokedBy: adminUid,
            updatedAt: now,
            updatedBy: adminUid,
          });
        }

        transaction.set(entitlementRef, next, { merge: false });
        transaction.create(auditRef, {
          action: command.action === 'grant'
            ? 'business_official_entitlement_granted'
            : 'business_official_entitlement_revoked',
          entitlementId,
          subjectType: command.subjectType,
          subjectId: command.subjectId,
          actorUid: adminUid,
          reason: command.reason,
          previousActive: previous?.['active'] === true,
          nextActive: next['active'] === true,
          previousCapabilities: previous?.['capabilities'] ?? null,
          nextCapabilities: next['capabilities'] ?? null,
          createdAt: now,
        });
        transaction.create(requestRef, {
          operationId: command.operationId,
          entitlementId,
          action: command.action,
          subjectType: command.subjectType,
          subjectId: command.subjectId,
          active: next['active'] === true,
          updatedAt: now,
          createdAt: now,
        });

        return {
          entitlementId,
          subjectType: command.subjectType,
          subjectId: command.subjectId,
          active: next['active'] === true,
          applied: true,
          updatedAt: now,
        };
      });
    }
  );
