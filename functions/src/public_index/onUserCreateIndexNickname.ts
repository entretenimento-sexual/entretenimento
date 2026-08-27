// functions/src/public_index/onUserCreateIndexNickname.ts
// -----------------------------------------------------------------------------
// Índice público de nickname derivado exclusivamente da projeção pública.
//
// Mantemos o nome exportado da Function para compatibilidade operacional, mas
// a fonte canônica deixa de ser users/{uid}. Assim uma conta em reverificação,
// suspensão ou qualquer fluxo que remova public_profiles/{uid} não pode ter o
// índice recriado por um evento atrasado do documento privado do usuário.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { db, FieldValue } from '../firebaseApp';

interface PublicProfileIndexDocument {
  nickname?: unknown;
  nicknameNormalized?: unknown;
  publicVisibility?: unknown;
}

function normalizeNicknameForIndex(value: unknown): string {
  const display = String(value ?? '').trim().replace(/\s+/g, ' ');
  const ascii = display
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return ascii
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 40);
}

function resolveIndexedNickname(
  profile: PublicProfileIndexDocument | null
): string {
  if (!profile) {
    return '';
  }

  const persistedNormalized = String(profile.nicknameNormalized ?? '')
    .trim()
    .toLowerCase();

  if (/^[a-z0-9._-]{3,40}$/.test(persistedNormalized)) {
    return persistedNormalized;
  }

  const fallback = normalizeNicknameForIndex(profile.nickname);
  return /^[a-z0-9._-]{3,40}$/.test(fallback) ? fallback : '';
}

function isPubliclyVisible(profile: PublicProfileIndexDocument): boolean {
  const visibility = String(profile.publicVisibility ?? '')
    .trim()
    .toLowerCase();

  return visibility !== 'hidden' && visibility !== 'private';
}

function nicknameIndexRef(nickname: string) {
  return db.collection('public_index').doc(`nickname:${nickname}`);
}

export const onUserCreateIndexNickname = onDocumentWritten(
  'public_profiles/{userId}',
  async (event) => {
    const uid = String(event.params.userId ?? '').trim();

    if (!uid) {
      return;
    }

    const after = event.data?.after;
    const currentProfile = after?.exists
      ? after.data() as PublicProfileIndexDocument
      : null;
    const currentNickname = currentProfile && isPubliclyVisible(currentProfile)
      ? resolveIndexedNickname(currentProfile)
      : '';
    const currentRef = currentNickname
      ? nicknameIndexRef(currentNickname)
      : null;
    const ownedIndexesPromise = db
      .collection('public_index')
      .where('uid', '==', uid)
      .get();
    const currentSnapshotPromise = currentRef ? currentRef.get() : null;
    const [ownedIndexes, currentSnapshot] = await Promise.all([
      ownedIndexesPromise,
      currentSnapshotPromise,
    ]);
    const batch = db.batch();
    let hasMutation = false;

    for (const indexDocument of ownedIndexes.docs) {
      if (!currentRef || indexDocument.ref.path !== currentRef.path) {
        batch.delete(indexDocument.ref);
        hasMutation = true;
      }
    }

    if (currentRef) {
      const indexedOwnerUid = currentSnapshot?.exists
        ? String(currentSnapshot.get('uid') ?? '').trim()
        : '';

      if (indexedOwnerUid && indexedOwnerUid !== uid) {
        console.error(
          `[public_index] Nickname '${currentNickname}' pertence a outro perfil.`
        );
      } else {
        batch.set(
          currentRef,
          {
            uid,
            type: 'nickname',
            value: currentNickname,
            updatedAt: FieldValue.serverTimestamp(),
            ...(currentSnapshot?.exists
              ? {}
              : {
                createdAt: FieldValue.serverTimestamp(),
                lastChangedAt: FieldValue.serverTimestamp(),
              }),
          },
          { merge: true }
        );
        hasMutation = true;
      }
    }

    if (!hasMutation) {
      return;
    }

    await batch.commit();

    if (currentNickname) {
      console.log(`[public_index] Nickname '${currentNickname}' sincronizado.`);
    } else if (ownedIndexes.size > 0) {
      console.log(`[public_index] Índice público removido para '${uid}'.`);
    }
  }
);
