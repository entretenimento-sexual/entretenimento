// Identidade individual com conexões sociais exige revisão; casal segue bloqueado.
// Firestore Rules prohibit any direct client modification of canonical identity.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertStaffAuthorization } from '../account_lifecycle/_shared';
import { normalizeProfileDiscoveryFields } from '../discovery/profile-discovery-normalization';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { assertCallableAppCheck } from '../shared/security/callable-app-check';
import {
  PROFILE_IDENTITY_CATALOG_VERSION,
  isCoupleProfileIdentityCode,
  resolveProfileIdentityOption,
} from './profile-identity.catalog';
import {
  canRequestIdentityChange, isStructuralProfileTypeChange, normalizeRequestedIdentityCode,
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
  async (request): Promise<{ status: 'APPROVED' | 'PENDING'; requestedIdentityCode: string }> => {
    assertCallableAppCheck(request.app);
    const uid = assertSignedIn(request.auth?.uid);
    const target = normalizeRequestedIdentityCode(request.data?.identityCode);
    if (!target) {
      throw new HttpsError('invalid-argument', 'Selecione uma identidade válida.');
    }
    const identity = resolveProfileIdentityOption(target);
    if (!identity || !identity.enabled || !identity.selectable) {
      throw new HttpsError('invalid-argument', 'Identidade indisponível.');
    }

    const ref = db.collection('profile_identity_change_requests').doc(uid);
    const userRef = db.collection('users').doc(uid);
    const publicRef = db.collection('public_profiles').doc(uid);
    const auditRef = db.collection('admin_logs').doc();
    const now = Date.now();
    return db.runTransaction(async (tx) => {
      // Todas as leituras antecedem as escritas da transação.
      const [userSnap, publicSnap, caseSnap, friendsSnap] = await Promise.all([
        tx.get(userRef), tx.get(publicRef), tx.get(ref),
        // Cobertura para contas com amizade ativa anterior ao marcador durável.
        tx.get(userRef.collection('friends').limit(1)),
      ]);
      if (!userSnap.exists || !publicSnap.exists) {
        throw new HttpsError('failed-precondition', 'Perfil não disponível.');
      }
      const user = userSnap.data() as Record<string, unknown>;
      const projected = publicSnap.data() as Record<string, unknown>;
      const current = identityOf(user);
      if (user['profileCompleted'] !== true ||
          String(user['accountStatus'] ?? 'active') !== 'active' ||
          user['interactionBlocked'] === true ||
          !normalizeRequestedIdentityCode(current) ||
          (projected['identityCode'] != null &&
            String(projected['identityCode']).trim().toLowerCase() !== current)) {
        throw new HttpsError('failed-precondition',
          'O estado do perfil precisa ser regularizado antes desta alteração.');
      }
      const previous = caseSnap.data() as RequestRecord | undefined;
      if (previous?.status === 'PENDING') {
        if (previous.currentIdentityCode === current && previous.requestedIdentityCode === target) {
          return { status: 'PENDING' as const, requestedIdentityCode: target };
        }
        throw new HttpsError('failed-precondition',
          'Já existe uma solicitação de alteração de identidade aguardando revisão.');
      }
      const decision = canRequestIdentityChange({
        currentCode: current, requestedCode: target,
        activeStatus: previous?.status,
        reviewedAt: previous?.reviewedAt,
        lastAppliedAt: user['identityChangedAtMs'],
        hasEstablishedSocialConnections:
          user['socialConnectionsEstablishedAt'] != null || !friendsSnap.empty,
        now,
      });
      if (decision === 'review-required') {
        const stamp = FieldValue.serverTimestamp();
        // PENDING não altera a identidade, a descoberta nem as amizades.
        tx.set(ref, {
          uid, currentIdentityCode: current, requestedIdentityCode: target,
          status: 'PENDING', requestedAt: now, updatedAt: stamp,
          reviewReason: 'established-social-connections', policyVersion: 2,
        });
        tx.create(auditRef, {
          adminUid: null, action: 'profileIdentityChangeReviewRequested',
          targetUserUid: uid,
          details: { reason: 'established-social-connections', policyVersion: 2 },
          timestamp: stamp,
        });
        return { status: 'PENDING' as const, requestedIdentityCode: target };
      }
      if (decision !== 'allowed') {
        throw new HttpsError('failed-precondition',
          decision === 'same-identity' ? 'Essa já é a identidade do perfil.'
            : decision === 'structural-change'
              ? 'Mudanças envolvendo casal precisam de consentimento específico e não estão disponíveis neste fluxo.'
              : decision === 'rate-limited'
                ? 'Aguarde 90 dias desde a última alteração de identidade.'
                : 'Identidade inválida.');
      }

      // Descoberta não pode manter a classificação antiga após a atualização.
      const discovery = normalizeProfileDiscoveryFields({
        ...user, gender: target,
      });
      const stamp = FieldValue.serverTimestamp();
      tx.update(userRef, {
        gender: target,
        declaredIdentityCode: target,
        identityCatalogVersion: PROFILE_IDENTITY_CATALOG_VERSION,
        identityChangedAtMs: now,
        updatedAt: stamp,
        updatedAtMs: now,
      });
      tx.update(publicRef, {
        gender: target,
        identityCode: target,
        identityLabel: identity.label,
        identityShortLabel: identity.shortLabel,
        identityCatalogVersion: PROFILE_IDENTITY_CATALOG_VERSION,
        normalizedGender: discovery.normalizedGender,
        normalizedOrientation: discovery.normalizedOrientation,
        compatibilityReady: discovery.compatibilityReady,
        updatedAt: stamp,
      });
      tx.set(ref, {
        uid, currentIdentityCode: current, requestedIdentityCode: target,
        status: 'APPROVED', requestedAt: now,
        reviewedAt: now, reviewedBy: 'SYSTEM_POLICY',
        updatedAt: stamp,
      });
      tx.create(auditRef, {
        adminUid: null,
        action: 'profileIdentityChangeAppliedByPolicy',
        targetUserUid: uid,
        details: { from: current, to: target, policyVersion: 1 },
        timestamp: stamp,
      });
      return { status: 'APPROVED' as const, requestedIdentityCode: target };
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
      if (approved && isStructuralProfileTypeChange(
        previous.currentIdentityCode, previous.requestedIdentityCode
      )) {
        throw new HttpsError('failed-precondition',
          'Mudanças entre perfil individual e casal exigem análise de composição e consentimento próprios.');
      }
      if (approved) {
        const identity = resolveProfileIdentityOption(previous.requestedIdentityCode);
        if (!identity || !identity.enabled || !identity.selectable) {
          throw new HttpsError('failed-precondition', 'Identidade inválida para aprovação.');
        }
        const patch = {
          gender: previous.requestedIdentityCode,
          declaredIdentityCode: previous.requestedIdentityCode,
          identityCatalogVersion: PROFILE_IDENTITY_CATALOG_VERSION,
          identityChangedAtMs: now,
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
        const discovery = normalizeProfileDiscoveryFields({
          ...user, gender: previous.requestedIdentityCode,
          ...(wasCouple !== becomesCouple ? { orientation: '' } : {}),
        });
        tx.update(publicRef, {
          normalizedGender: discovery.normalizedGender,
          normalizedOrientation: discovery.normalizedOrientation,
          compatibilityReady: discovery.compatibilityReady,
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
