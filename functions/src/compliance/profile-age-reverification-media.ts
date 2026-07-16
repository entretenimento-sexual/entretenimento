import type {
  DocumentSnapshot,
  QuerySnapshot,
  Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../firebaseApp';

const MAX_TRANSACTIONAL_PUBLIC_MEDIA = 420;

interface PublicMediaDocument {
  visibility?: unknown;
  ageReverificationHidden?: unknown;
  ageReverificationCaseId?: unknown;
  ageReverificationPreviousVisibility?: unknown;
}

export interface ProfilePublicMediaSnapshots {
  readonly photos: QuerySnapshot;
  readonly videos: QuerySnapshot;
  readonly total: number;
}

export async function readProfilePublicMediaSnapshots(
  transaction: Transaction,
  targetUid: string
): Promise<ProfilePublicMediaSnapshots> {
  const publicProfileRef = db.collection('public_profiles').doc(targetUid);
  const [photos, videos] = await Promise.all([
    transaction.get(publicProfileRef.collection('public_photos')),
    transaction.get(publicProfileRef.collection('public_videos')),
  ]);
  const total = photos.size + videos.size;

  if (total > MAX_TRANSACTIONAL_PUBLIC_MEDIA) {
    throw new HttpsError(
      'failed-precondition',
      'O perfil possui mais mídias públicas do que esta revisão pode ' +
        'processar de forma transacional. Encaminhe o caso ao suporte técnico.'
    );
  }

  return { photos, videos, total };
}

export function hideProfilePublicMedia(
  transaction: Transaction,
  snapshots: ProfilePublicMediaSnapshots,
  caseId: string,
  hiddenAt: number
): void {
  for (const document of allDocuments(snapshots)) {
    const data = document.data() as PublicMediaDocument;
    const currentVisibility = normalizeVisibility(data.visibility);

    if (
      data.ageReverificationHidden === true &&
      String(data.ageReverificationCaseId ?? '').trim() === caseId
    ) {
      continue;
    }

    transaction.set(
      document.ref,
      {
        visibility: 'PRIVATE',
        ageReverificationHidden: true,
        ageReverificationCaseId: caseId,
        ageReverificationPreviousVisibility: currentVisibility,
        ageReverificationHiddenAt: hiddenAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

export function restoreProfilePublicMedia(
  transaction: Transaction,
  snapshots: ProfilePublicMediaSnapshots,
  caseId: string,
  restoredAt: number
): void {
  for (const document of allDocuments(snapshots)) {
    const data = document.data() as PublicMediaDocument;
    const hiddenByCurrentCase = data.ageReverificationHidden === true &&
      String(data.ageReverificationCaseId ?? '').trim() === caseId;

    if (!hiddenByCurrentCase) {
      continue;
    }

    transaction.set(
      document.ref,
      {
        visibility: normalizeVisibility(
          data.ageReverificationPreviousVisibility
        ),
        ageReverificationHidden: FieldValue.delete(),
        ageReverificationCaseId: FieldValue.delete(),
        ageReverificationPreviousVisibility: FieldValue.delete(),
        ageReverificationHiddenAt: FieldValue.delete(),
        ageReverificationRestoredAt: restoredAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}

function allDocuments(
  snapshots: ProfilePublicMediaSnapshots
): readonly DocumentSnapshot[] {
  return [...snapshots.photos.docs, ...snapshots.videos.docs];
}

function normalizeVisibility(value: unknown): string {
  const visibility = String(value ?? '').trim().toUpperCase();

  return [
    'PRIVATE',
    'FRIENDS',
    'SUBSCRIBERS',
    'PREMIUM',
    'PUBLIC',
  ].includes(visibility)
    ? visibility
    : 'PUBLIC';
}
