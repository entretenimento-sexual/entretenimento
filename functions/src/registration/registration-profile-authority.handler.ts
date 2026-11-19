// Registration nickname ownership uses the existing public_index document.
// Only the backend creates nickname index entries.
// Separate operations preserve existing callable names and reactive Angular facade.
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { warn } from 'firebase-functions/logger';
import type { UserRecord } from 'firebase-admin/auth';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue, Timestamp, auth } from '../firebaseApp';
import { assertCallableAppCheck } from '../shared/security/callable-app-check';
import { TERMS_ACCEPTANCE_VERSION } from '../compliance/platform-legal.constants';
import { buildInitialUserSeed, buildRegistrationAuthProjection } from '../auth/user-registration-seed';
import {
  PROFILE_IDENTITY_CATALOG_VERSION, isSelectableProfileIdentityCode,
} from '../identity/profile-identity.catalog';
import {
  evaluateCanonicalAgeEligibility, isAdultAccountAdmissionDecision,
} from '../compliance/age-eligibility.policy';
import {
  canClaimRegistrationNickname, normalizeRegistrationNickname, normalizeRegistrationNicknameClaim,
  resolveStoredRegistrationNickname, type RegistrationNickname,
} from './nickname-reservation.policy';
import { hasNicknameOwnerWithoutIndex } from './registration-nickname-availability.policy';
import { assertRegistrationPasswordDefined } from './email-link-preview.handler';

interface CompleteRegistrationInput {
  uid: unknown;
  nickname?: unknown;
  gender?: unknown;
  orientation?: unknown;
  estado?: unknown;
  municipio?: unknown;
}
const ORIENTATIONS = new Set(['bissexual','homossexual','heterossexual','pansexual']);
const UFS = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]);

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function signedOwner(uid: unknown): string {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new HttpsError('unauthenticated', 'Entre na sua conta para continuar.');
  }
  return uid;
}

function nicknameInput(nickname: RegistrationNickname | null): RegistrationNickname {
  if (!nickname) {
    throw new HttpsError('invalid-argument', 'Informe um nickname válido.', {
      reason: 'nickname/invalid',
    });
  }
  return nickname;
}

function nicknameForAccount(
  display: string, user: FirebaseFirestore.DocumentData
): RegistrationNickname {
  const stored = resolveStoredRegistrationNickname(user['nickname'], user['nicknameNormalized']);
  if (stored?.display === display) return stored;
  return nicknameInput(normalizeRegistrationNicknameClaim(display));
}

function assertClaimAllowed(
  decision: ReturnType<typeof canClaimRegistrationNickname>
): void {
  if (decision === 'allowed') return;
  if (decision === 'in-use') {
    throw new HttpsError('already-exists', 'Este nickname já está em uso.', {
      reason: 'nickname/in-use',
    });
  }
  throw new HttpsError('failed-precondition',
    'O nickname existente não pode ser alterado neste cadastro.', {
      reason: 'nickname/change-not-allowed',
    });
}

function ownerOf(data: FirebaseFirestore.DocumentData | undefined): string | undefined {
  return data ? String(data['uid'] ?? '') : undefined;
}

async function getNicknameOwnership(
  tx: FirebaseFirestore.Transaction, uid: string, nickname: RegistrationNickname,
  currentDisplay?: unknown,
) {
  const indexRef = db.collection('public_index').doc(`nickname:${nickname.key}`);
  const indexSnap = await tx.get(indexRef);
  assertClaimAllowed(canClaimRegistrationNickname({
    uid, requested: nickname, currentDisplay,
    indexOwnerUid: ownerOf(indexSnap.data()),
  }));
  if (!indexSnap.exists && await hasNicknameOwnerWithoutIndex(db, nickname, { tx, uid })) {
    assertClaimAllowed('in-use');
  }
  return { indexRef, indexExists: indexSnap.exists };
}

function reserveInTransaction(
  tx: FirebaseFirestore.Transaction,
  uid: string,
  nickname: RegistrationNickname,
  { indexRef, indexExists }:
    Awaited<ReturnType<typeof getNicknameOwnership>>,
): void {
  const now = FieldValue.serverTimestamp();
  if (!indexExists) {
    tx.create(indexRef, {
      uid, type: 'nickname', value: nickname.key,
      createdAt: now, lastChangedAt: now,
    });
  }
}

async function syncRegistrationDisplayName(user: UserRecord, nickname: string): Promise<void> {
  if (user.displayName === nickname) return;

  try {
    await auth.updateUser(user.uid, { displayName: nickname });
  } catch (error) {
    warn('Falha ao sincronizar o apelido do cadastro no Authentication.', {
      code: (error as { code?: unknown } | null)?.code,
    });
  }
}

export const reserveRegistrationNickname = onCall<{ nickname?: unknown; expectedUid?: unknown }>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ nickname: string; normalized: string }> => {
    assertCallableAppCheck(request.app);
    const uid = signedOwner(request.auth?.uid);
    if (request.data?.expectedUid !== undefined && request.data.expectedUid !== uid) {
      throw new HttpsError('permission-denied', 'A conta ativa mudou durante o cadastro.');
    }
    await assertRegistrationPasswordDefined(uid);
    const { display } = nicknameInput(normalizeRegistrationNickname(request.data?.nickname));
    const authUser = await auth.getUser(uid);
    if (authUser.disabled) {
      throw new HttpsError('failed-precondition', 'Conta indisponível para registro.');
    }
    const userRef = db.collection('users').doc(uid);
    const result = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const user = userSnap.data() ?? {};
      if (userSnap.exists && (
        user['accountStatus'] !== 'active' ||
        user['accountLocked'] === true ||
        user['suspended'] === true ||
        user['loginAllowed'] === false ||
        user['deletionRequestedAt'] != null
      )) {
        throw new HttpsError('failed-precondition', 'Conta indisponível para registro.');
      }
      if (user['profileCompleted'] === true) assertClaimAllowed('account-completed');
      const nickname = nicknameForAccount(display, user);
      const ownership = await getNicknameOwnership(tx, uid, nickname, user['nickname']);

      // Idempotent under Auth onCreate races. Never reset consent, billing or age.
      if (userSnap.exists) {
        tx.update(userRef, {
          ...buildRegistrationAuthProjection(authUser),
          nickname: nickname.display,
          nicknameNormalized: nickname.key,
          ...(!Array.isArray(user['nicknameHistory']) || user['nicknameHistory'].length === 0
            ? { nicknameHistory: [{ nickname: nickname.key, date: Timestamp.now() }] }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.create(userRef, {
          ...buildInitialUserSeed(authUser, { source: 'registration-recovery' }),
          nickname: nickname.display,
          nicknameNormalized: nickname.key,
          nicknameHistory: [{ nickname: nickname.key, date: Timestamp.now() }],
        });
      }
      reserveInTransaction(tx, uid, nickname, ownership);
      return { nickname: nickname.display, normalized: nickname.key };
    });
    await syncRegistrationDisplayName(authUser, result.nickname);
    return result;
  }
);

export const completeRegistrationProfile = onCall<CompleteRegistrationInput>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ status: 'COMPLETED'; nickname: string }> => {
    assertCallableAppCheck(request.app);
    const uid = signedOwner(request.auth?.uid);
    // O UID do formulário vincula a operação à conta que iniciou o cadastro.
    const expectedUid = request.data?.uid;
    if (typeof expectedUid !== 'string' || !expectedUid) {
      throw new HttpsError('invalid-argument', 'Não foi possível identificar a conta que iniciou o cadastro.');
    }
    if (expectedUid !== uid) {
      throw new HttpsError('permission-denied', 'A conta ativa mudou durante o cadastro.', {
        reason: 'auth/session-changed',
      });
    }
    await assertRegistrationPasswordDefined(uid);

    const { display } = nicknameInput(normalizeRegistrationNickname(request.data?.nickname));
    const gender = String(request.data?.gender ?? '').trim().toLowerCase();
    const orientation = String(request.data?.orientation ?? '').trim().toLowerCase();
    const estado = String(request.data?.estado ?? '').trim().toUpperCase();
    const municipio = String(request.data?.municipio ?? '').trim();
    if (!isSelectableProfileIdentityCode(gender) ||
      (orientation && !ORIENTATIONS.has(orientation)) || !UFS.has(estado) ||
      !municipio || municipio.length > 120 || hasControlCharacter(municipio)) {
      throw new HttpsError('invalid-argument', 'Revise os dados necessários para concluir o perfil.');
    }

    const authUser = await auth.getUser(uid);
    if (!authUser.emailVerified || authUser.disabled) {
      throw new HttpsError('failed-precondition', 'Verifique seu e-mail e a situação da conta.');
    }

    const userRef = db.collection('users').doc(uid);
    const publicRef = db.collection('public_profiles').doc(uid);
    const ageRef = db.collection('age_eligibility_records').doc(uid);
    const result = await db.runTransaction(async (tx) => {
      const [userSnap, publicSnap, ageSnap] =
        await Promise.all([
          tx.get(userRef), tx.get(publicRef),
          tx.get(ageRef),
        ]);
      if (!userSnap.exists) {
        throw new HttpsError('failed-precondition', 'Dados da conta não encontrados.');
      }
      const user = userSnap.data()!;
      const nickname = nicknameForAccount(display, user);
      if (user['accountStatus'] !== 'active' || user['accountLocked'] === true ||
        user['suspended'] === true || user['loginAllowed'] === false ||
        user['deletionRequestedAt'] != null) {
        throw new HttpsError('failed-precondition', 'Conta indisponível.');
      }
      const terms = user['acceptedTerms'] as Record<string, unknown> | undefined;
      // A autorização depende da versão vigente e do aceite de privacidade.
      // Um booleano legado não equivale ao aceite canônico das Rules.
      // O consentimento adulto legado não é condição independente.
      // Termos v3 + decisão etária canônica permanecem mandatórios.
      if (terms?.['accepted'] !== true ||
        terms?.['version'] !== TERMS_ACCEPTANCE_VERSION ||
        terms?.['acknowledgedPrivacyNotice'] !== true) {
        throw new HttpsError('failed-precondition',
          'Aceite os Termos de Uso vigentes para concluir o cadastro.',
          { reason: 'terms_required', recommendedAction: 'accept_terms' });
      }
      const age = evaluateCanonicalAgeEligibility({
        uid, rawRecord: ageSnap.data() ?? null,
      });
      if (!isAdultAccountAdmissionDecision(age)) {
        throw new HttpsError('permission-denied',
          'Conta sem autoridade etária canônica válida para conclusão.');
      }
      if (user['profileCompleted'] === true) {
        if (publicSnap.exists && user['nickname'] === nickname.display &&
          publicSnap.get('nicknameNormalized') === nickname.key) {
          return { status: 'COMPLETED' as const, nickname: nickname.display };
        }
        throw new HttpsError('failed-precondition', 'Perfil já foi concluído.');
      }
      const ownership = await getNicknameOwnership(tx, uid, nickname, user['nickname']);

      if (publicSnap.exists && (
        publicSnap.get('uid') !== uid ||
        publicSnap.get('nicknameNormalized') !== nickname.key
      )) {
        throw new HttpsError('failed-precondition', 'Projeção pública inconsistente.');
      }

      const now = FieldValue.serverTimestamp();
      const nowMs = Date.now();
      tx.update(userRef, {
        nickname: nickname.display,
        nicknameNormalized: nickname.key,
        ...(!Array.isArray(user['nicknameHistory']) || user['nicknameHistory'].length === 0
          ? { nicknameHistory: [{ nickname: nickname.key, date: Timestamp.fromMillis(nowMs) }] }
          : {}),
        gender, declaredIdentityCode: gender,
        identityCatalogVersion: PROFILE_IDENTITY_CATALOG_VERSION,
        orientation, estado, municipio,
        ...buildRegistrationAuthProjection(authUser),
        profileCompleted: true, publicVisibility: 'visible',
        interactionBlocked: false, registrationCompletedAt: now,
        updatedAt: now, updatedAtMs: nowMs,
      });

      const publicFields: Record<string, unknown> = {
        uid, nickname: nickname.display, nicknameNormalized: nickname.key,
        gender, identityCode: gender,
        identityCatalogVersion: PROFILE_IDENTITY_CATALOG_VERSION,
        orientation: orientation || null, estado, municipio,
        updatedAt: now,
      };
      if (!publicSnap.exists) {
        publicFields['createdAt'] = now;
        publicFields['role'] = 'free';
      }
      tx.set(publicRef, publicFields, { merge: true });
      reserveInTransaction(tx, uid, nickname, ownership);
      return { status: 'COMPLETED' as const, nickname: nickname.display };
    });
    await syncRegistrationDisplayName(authUser, result.nickname);
    return result;
  }
);
