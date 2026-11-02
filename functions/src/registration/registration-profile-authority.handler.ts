// Registration nickname ownership. Firebase Admin SDK is the only writer of
// nickname_reservations: clients cannot create aliases or bypass key normalization.
// Separate operations preserve existing callable names and reactive Angular facade.
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue, Timestamp, auth } from '../firebaseApp';
import { assertCallableAppCheck } from '../shared/security/callable-app-check';
import { buildInitialUserSeed } from '../auth/user-registration-seed';
import {
  PROFILE_IDENTITY_CATALOG_VERSION, isSelectableProfileIdentityCode,
} from '../identity/profile-identity.catalog';
import {
  evaluateCanonicalAgeEligibility, isAdultAccountAdmissionDecision,
} from '../compliance/age-eligibility.policy';
import {
  canClaimRegistrationNickname, normalizeRegistrationNickname,
} from './nickname-reservation.policy';

interface CompleteRegistrationInput {
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

function nicknameInput(value: unknown) {
  const nickname = normalizeRegistrationNickname(value);
  if (!nickname) {
    throw new HttpsError('invalid-argument', 'Informe um nickname válido.', {
      reason: 'nickname/invalid',
    });
  }
  return nickname;
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

function reserveInTransaction(
  tx: FirebaseFirestore.Transaction,
  uid: string,
  nickname: { display: string; key: string },
  indexRef: FirebaseFirestore.DocumentReference,
  reservationRef: FirebaseFirestore.DocumentReference,
  indexExists: boolean,
  reservationExists: boolean
): void {
  const now = FieldValue.serverTimestamp();
  if (!indexExists) {
    tx.create(indexRef, {
      uid, type: 'nickname', value: nickname.key,
      createdAt: now, lastChangedAt: now,
    });
  }
  if (!reservationExists) {
    tx.create(reservationRef, {
      uid, key: nickname.key, state: 'RESERVED', reservedAt: now,
      policyVersion: 1,
    });
  }
}

export const reserveRegistrationNickname = onCall<{ nickname?: unknown }>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ nickname: string; normalized: string }> => {
    assertCallableAppCheck(request.app);
    const uid = signedOwner(request.auth?.uid);
    const nickname = nicknameInput(request.data?.nickname);
    const authUser = await auth.getUser(uid);
    const userRef = db.collection('users').doc(uid);
    const indexRef = db.collection('public_index').doc(`nickname:${nickname.key}`);
    const reservationRef = db.collection('nickname_reservations').doc(nickname.key);

    return db.runTransaction(async (tx) => {
      const [userSnap, indexSnap, reservationSnap] = await Promise.all([
        tx.get(userRef), tx.get(indexRef), tx.get(reservationRef),
      ]);
      const user = userSnap.data() ?? {};
      if (userSnap.exists && (
        user['accountStatus'] !== 'active' || user['accountLocked'] === true
      )) {
        throw new HttpsError('failed-precondition', 'Conta indisponível para registro.');
      }
      assertClaimAllowed(canClaimRegistrationNickname({
        uid, requested: nickname, currentDisplay: user['nickname'],
        completed: user['profileCompleted'] === true,
        indexOwnerUid: ownerOf(indexSnap.data()),
        reservationOwnerUid: ownerOf(reservationSnap.data()),
      }));

      // Idempotent under Auth onCreate races. Never reset consent, billing or age.
      if (userSnap.exists) {
        tx.update(userRef, {
          nickname: nickname.display,
          ...(!Array.isArray(user['nicknameHistory']) || user['nicknameHistory'].length === 0
            ? { nicknameHistory: [{ nickname: nickname.key, date: Timestamp.now() }] }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.create(userRef, {
          ...buildInitialUserSeed(authUser, { source: 'registration-recovery' }),
          nickname: nickname.display,
          nicknameHistory: [{ nickname: nickname.key, date: Timestamp.now() }],
        });
      }
      reserveInTransaction(tx, uid, nickname, indexRef, reservationRef,
        indexSnap.exists, reservationSnap.exists);
      return { nickname: nickname.display, normalized: nickname.key };
    });
  }
);

export const completeRegistrationProfile = onCall<CompleteRegistrationInput>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ status: 'COMPLETED'; nickname: string }> => {
    assertCallableAppCheck(request.app);
    const uid = signedOwner(request.auth?.uid);
    const nickname = nicknameInput(request.data?.nickname);
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
    const indexRef = db.collection('public_index').doc(`nickname:${nickname.key}`);
    const reservationRef = db.collection('nickname_reservations').doc(nickname.key);
    const ageRef = db.collection('age_eligibility_records').doc(uid);
    return db.runTransaction(async (tx) => {
      const [userSnap, publicSnap, indexSnap, reservationSnap, ageSnap] =
        await Promise.all([
          tx.get(userRef), tx.get(publicRef), tx.get(indexRef),
          tx.get(reservationRef), tx.get(ageRef),
        ]);
      if (!userSnap.exists) {
        throw new HttpsError('failed-precondition', 'Dados da conta não encontrados.');
      }
      const user = userSnap.data()!;
      if (user['accountStatus'] !== 'active' || user['accountLocked'] === true ||
        user['suspended'] === true) {
        throw new HttpsError('failed-precondition', 'Conta indisponível.');
      }
      const terms = user['acceptedTerms'] as Record<string, unknown> | undefined;
      const adult = user['adultConsent'] as Record<string, unknown> | undefined;
      if (terms?.['accepted'] !== true || adult?.['accepted'] !== true) {
        throw new HttpsError('failed-precondition',
          'Confirme os termos e o consentimento de acesso adulto.');
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
      assertClaimAllowed(canClaimRegistrationNickname({
        uid, requested: nickname, currentDisplay: user['nickname'],
        indexOwnerUid: ownerOf(indexSnap.data()),
        reservationOwnerUid: ownerOf(reservationSnap.data()),
      }));

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
        ...(!Array.isArray(user['nicknameHistory']) || user['nicknameHistory'].length === 0
          ? { nicknameHistory: [{ nickname: nickname.key, date: Timestamp.fromMillis(nowMs) }] }
          : {}),
        gender, declaredIdentityCode: gender,
        identityCatalogVersion: PROFILE_IDENTITY_CATALOG_VERSION,
        orientation, estado, municipio,
        emailVerified: true,
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
      reserveInTransaction(tx, uid, nickname, indexRef, reservationRef,
        indexSnap.exists, reservationSnap.exists);
      return { status: 'COMPLETED' as const, nickname: nickname.display };
    });
  }
);
