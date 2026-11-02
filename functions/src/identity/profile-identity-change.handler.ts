// Controlled identity-change request and staff review. No client-side
// mutation of gender/declaredIdentityCode/public discovery identity is allowed.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertStaffAuthorization } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { assertCallableAppCheck } from '../shared/security/callable-app-check';
import {
  PROFILE_IDENTITY_CATALOG_VERSION,
  isCoupleProfileIdentityCode,
  resolveProfileIdentityOption,
} from './profile-identity.catalog';
import {
  canRequestIdentityChange, normalizeRequestedIdentityCode,
} from './profile-identity-change.policy';

type RequestRecord = {
  uid: string;
  currentIdentityCode: string;
  requestedIdentityCode: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';
  requestedAt: number;
  reviewedAt?: number;
};

function ownerUid(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
    ? value : '';
}

function assertSignedIn(uid: unknown): string {
  const id = ownerUid(uid);
  if (!id) throw new HttpsError('unauthenticated', 'Entre na sua conta para continuar.');
  return id;
}

function identityOf(user: Record<string, unknown>): string {
  return String(user['declaredIdentityCode'] ?? user['gender'] ?? '')
    .trim().toLowerCase();
}

export const getMyProfileIdentityChange = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{
    status: RequestRecord['status'] | null;
    requestedIdentityCode: string | null;
  }> => {
    assertCallableAppCheck(request.app);
    const uid = assertSignedIn(request.auth?.uid);
    const snapshot = await db.collection('profile_identity_change_requests').doc(uid).get();
    const record = snapshot.data() as RequestRecord | undefined;
    return {
      status: record?.status ?? null,
      requestedIdentityCode: record?.requestedIdentityCode ?? null,
    };
  }
);

export const requestProfileIdentityChange = onCall<{ identityCode?: unknown }>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ status: 'PENDING'; requestedIdentityCode: string }> => {
    assertCallableAppCheck(request.app);
    const uid = assertSignedIn(request.auth?.uid);
    const target = normalizeRequestedIdentityCode(request.data?.identityCode);
    if (!target) {
      throw new HttpsError('invalid-argument', 'Selecione uma identidade válida.');
    }
    const ref = db.collection('profile_identity_change_requests').doc(uid);
    const userRef = db.collection('users').doc(uid);
    const now = Date.now();
    return db.runTransaction(async (tx) => {
      const [userSnap, caseSnap] = await Promise.all([tx.get(userRef), tx.get(ref)]);
      if (!userSnap.exists) throw new HttpsError('not-found', 'Conta indisponível.');
      const user = userSnap.data() as Record<string, unknown>;
      if (
        user['profileCompleted'] !== true ||
        String(user['accountStatus'] ?? 'active') !== 'active' ||
        user['interactionBlocked'] === true
      ) {
        throw new HttpsError('failed-precondition',
          'A conta precisa estar ativa para solicitar essa alteração.');
      }
      const previous = caseSnap.data() as RequestRecord | undefined;
      const status = canRequestIdentityChange({
        currentCode: identityOf(user),
        requestedCode: target,
        activeStatus: previous?.status,
        requestedAt: previous?.requestedAt,
        now,
      });
      if (status === 'pending' && previous?.requestedIdentityCode === target) {
        return { status: 'PENDING' as const, requestedIdentityCode: target };
      }
      if (status !== 'allowed') {
        throw new HttpsError('failed-precondition',
          status === 'same-identity' ? 'Essa já é a identidade do perfil.'
          : status === 'pending' ? 'Já existe uma solicitação em análise.'
          : status === 'rate-limited' ? 'Aguarde antes de enviar outra solicitação.'
          : 'Solicitação inválida.');
      }

      tx.set(ref, {
        uid, currentIdentityCode: identityOf(user),
        requestedIdentityCode: target, status: 'PENDING',
        requestedAt: now, reviewedAt: null, reviewedBy: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { status: 'PENDING' as const, requestedIdentityCode: target };
    });
  }
);

export const reviewProfileIdentityChange = onCall<{
  uid?: unknown; decision?: unknown; resolution?: unknown;
}>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ status: 'APPROVED' | 'REJECTED' }> => {
    assertCallableAppCheck(request.app);
    const actor = assertSignedIn(request.auth?.uid);
    await assertStaffAuthorization({
      actorUid: actor,
      authToken: request.auth?.token ?? {},
      requiredPermission: 'users:suspend',
    });

    const uid = ownerUid(request.data?.uid);
    const decision = String(request.data?.decision ?? '').trim().toUpperCase();
    const resolution = String(request.data?.resolution ?? '').replace(/\s+/g, ' ').trim();
    if (!uid || !['APPROVE', 'REJECT'].includes(decision) ||
        resolution.length < 8 || resolution.length > 500) {
      throw new HttpsError('invalid-argument',
        'Informe a conta, a decisão e uma justificativa objetiva.');
    }
    const caseRef = db.collection('profile_identity_change_requests').doc(uid);
    const userRef = db.collection('users').doc(uid);
    const publicRef = db.collection('public_profiles').doc(uid);
    const auditRef = db.collection('admin_logs').doc();
    const approved = decision === 'APPROVE';
    const resultStatus = approved ? 'APPROVED' : 'REJECTED';

    await db.runTransaction(async (tx) => {
      const [caseSnap, userSnap, publicSnap] = await Promise.all([
        tx.get(caseRef), tx.get(userRef), tx.get(publicRef),
      ]);
      const previous = caseSnap.data() as RequestRecord | undefined;
      const user = userSnap.data() as Record<string, unknown> | undefined;
      if (!previous || previous.status !== 'PENDING' || !user) {
        throw new HttpsError('failed-precondition',
          'A solicitação ou a conta não está disponível para revisão.');
      }
      // Rejeitar deve continuar possível se o perfil foi ocultado/suspenso
      // após o pedido; não deixar uma solicitação pendente sem resolução.
      if (approved && (
        !publicSnap.exists ||
        previous.currentIdentityCode !== identityOf(user) ||
        String(user['accountStatus'] ?? 'active') !== 'active' ||
        user['profileCompleted'] !== true ||
        user['interactionBlocked'] === true ||
        !normalizeRequestedIdentityCode(previous.requestedIdentityCode)
      )) {
        throw new HttpsError('failed-precondition',
          'A identidade ou o estado da conta mudou. Reavalie antes de aprovar.');
      }
      const now = Date.now();
      const stamp = FieldValue.serverTimestamp();
      if (approved) {
        const identity = resolveProfileIdentityOption(previous.requestedIdentityCode);
        if (!identity || !identity.enabled || !identity.selectable) {
          throw new HttpsError('failed-precondition', 'Identidade inválida para aprovação.');
        }
        const patch = {
          gender: previous.requestedIdentityCode,
          declaredIdentityCode: previous.requestedIdentityCode,
          identityCatalogVersion: PROFILE_IDENTITY_CATALOG_VERSION,
          updatedAt: stamp, updatedAtMs: now,
        };
        // A composição individual/casal modifica o tipo de perfil.
        // Dados específicos da composição anterior não devem permanecer ativos.
        const wasCouple = isCoupleProfileIdentityCode(previous.currentIdentityCode);
        const becomesCouple = isCoupleProfileIdentityCode(previous.requestedIdentityCode);
        if (wasCouple !== becomesCouple) {
          tx.update(userRef, {
            ...patch,
            orientation: '',
            partner1Orientation: FieldValue.delete(),
            partner2Orientation: FieldValue.delete(),
          });
        } else {
          tx.update(userRef, patch);
        }
        tx.update(publicRef, {
          ...(wasCouple !== becomesCouple ? { orientation: null } : {}),
          gender: previous.requestedIdentityCode,
          identityCode: previous.requestedIdentityCode,
          identityLabel: identity.label,
          identityShortLabel: identity.shortLabel,
          identityCatalogVersion: PROFILE_IDENTITY_CATALOG_VERSION,
          updatedAt: stamp,
        });
      }
      tx.update(caseRef, {
        status: resultStatus,
        reviewedAt: now,
        reviewedBy: actor,
        updatedAt: stamp,
      });
      tx.create(auditRef, {
        adminUid: actor,
        action: 'profileIdentityChangeReviewed',
        targetUserUid: uid,
        details: {
          status: resultStatus,
          from: previous.currentIdentityCode,
          to: previous.requestedIdentityCode,
          resolution,
        },
        timestamp: stamp,
      });
    });
    return { status: resultStatus };
  }
);
