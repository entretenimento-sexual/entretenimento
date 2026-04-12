//functions\src\account_lifecycle\reactivateSelfSuspension.ts
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../firebaseApp';

interface AccountLifecycleCommandResult {
  ok: boolean;
  accountStatus?: string | null;
  message?: string | null;
}

type UserDoc = {
  uid?: string;
  nickname?: string | null;
  nicknameNormalized?: string | null;
  photoURL?: string | null;
  municipio?: string | null;
  estado?: string | null;
  gender?: string | null;
  orientation?: string | null;
  role?: string | null;
  accountStatus?: string | null;
  publicVisibility?: 'visible' | 'hidden' | null;
  interactionBlocked?: boolean | null;
};

function normalizeNicknameForIndex(raw?: string | null): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function getNicknameIndexDocId(user: UserDoc): string | null {
  const normalized =
    String(user.nicknameNormalized ?? '').trim() ||
    normalizeNicknameForIndex(user.nickname);

  return normalized ? `nickname:${normalized}` : null;
}

function buildPublicProfileSeed(user: UserDoc, now: number) {
  return {
    uid: user.uid ?? null,
    nickname: user.nickname ?? null,
    nicknameNormalized:
      String(user.nicknameNormalized ?? '').trim() ||
      normalizeNicknameForIndex(user.nickname),
    avatarUrl: user.photoURL ?? null,
    municipio: user.municipio ?? null,
    estado: user.estado ?? null,
    gender: user.gender ?? null,
    orientation: user.orientation ?? null,
    role: user.role ?? 'basic',
    updatedAt: now,
    createdAt: now,
  };
}

export const reactivateSelfSuspension = onCall<Record<string, never>>(
  async (request): Promise<AccountLifecycleCommandResult> => {
    const uid = request.auth?.uid ?? null;

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const now = Date.now();

    await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
      const userRef = db.collection('users').doc(uid);
      const publicProfileRef = db.collection('public_profiles').doc(uid);

      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new HttpsError('not-found', 'Usuário não encontrado.');
      }

      const user = (userSnap.data() ?? {}) as UserDoc;
      const currentStatus = String(user.accountStatus ?? 'active');

      if (currentStatus === 'deleted') {
        throw new HttpsError('failed-precondition', 'Conta já excluída.');
      }

      if (currentStatus !== 'self_suspended') {
        return;
      }

      tx.set(
        userRef,
        {
          accountStatus: 'active',
          publicVisibility: 'visible',
          interactionBlocked: false,
          loginAllowed: true,

          suspended: false,
          suspensionReason: null,
          suspensionSource: null,
          suspensionEndsAt: null,

          unsuspendedAtMs: now,
          unsuspendedBy: 'self',

          statusUpdatedAt: now,
          statusUpdatedBy: 'self',
        },
        { merge: true }
      );

      tx.set(publicProfileRef, buildPublicProfileSeed({ ...user, uid }, now), { merge: true });

      const nicknameIndexDocId = getNicknameIndexDocId(user);
      if (nicknameIndexDocId) {
        const nicknameIndexRef = db.collection('public_index').doc(nicknameIndexDocId);
        tx.set(
          nicknameIndexRef,
          {
            type: 'nickname',
            value:
              String(user.nicknameNormalized ?? '').trim() ||
              normalizeNicknameForIndex(user.nickname),
            uid,
            createdAt: now,
            lastChangedAt: now,
          },
          { merge: true }
        );
      }

      const auditRef = db.collection('account_lifecycle_audit').doc();
      tx.set(auditRef, {
        uid,
        action: 'reactivate_self_suspension',
        accountStatus: 'active',
        source: 'self',
        moderationReason: null,
        createdAt: now,
        updatedAt: now,
      });
    });

    return {
      ok: true,
      accountStatus: 'active',
      message: 'Conta reativada com sucesso.',
    };
  }
);