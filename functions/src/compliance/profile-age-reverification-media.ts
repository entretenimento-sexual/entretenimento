import type {
  DocumentSnapshot,
  QuerySnapshot,
  Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../firebaseApp';

const MAX_TRANSACTIONAL_MEDIA_DOCUMENTS = 420;

interface MediaVisibilityDocument {
  visibility?: unknown;
  ageReverificationHidden?: unknown;
  ageReverificationCaseId?: unknown;
  ageReverificationPreviousVisibility?: unknown;
}

export interface ProfileMediaVisibilitySnapshots {
  readonly publicPhotos: QuerySnapshot;
  readonly publicVideos: QuerySnapshot;
  readonly photoPublications: QuerySnapshot;
  readonly videoPublications: QuerySnapshot;
  readonly totalDocuments: number;
}

export async function readProfileMediaVisibilitySnapshots(
  transaction: Transaction,
  targetUid: string
): Promise<ProfileMediaVisibilitySnapshots> {
  const publicProfileRef = db.collection('public_profiles').doc(targetUid);
  const userRef = db.collection('users').doc(targetUid);
  const [
    publicPhotos,
    publicVideos,
    photoPublications,
    videoPublications,
  ] = await Promise.all([
    transaction.get(publicProfileRef.collection('public_photos')),
    transaction.get(publicProfileRef.collection('public_videos')),
    transaction.get(userRef.collection('photo_publications')),
    transaction.get(userRef.collection('video_publications')),
  ]);
  const totalDocuments = publicPhotos.size +
    publicVideos.size +
    photoPublications.size +
    videoPublications.size;

  if (totalDocuments > MAX_TRANSACTIONAL_MEDIA_DOCUMENTS) {
    throw new HttpsError(
      'failed-precondition',
      'O perfil possui mais documentos de mídia do que esta revisão pode ' +
        'processar de forma transacional. Encaminhe o caso ao suporte técnico.'
    );
  }

  return {
    publicPhotos,
    publicVideos,
    photoPublications,
    videoPublications,
    totalDocuments,
  };
}

export function hideProfileMediaVisibility(
  transaction: Transaction,
  snapshots: ProfileMediaVisibilitySnapshots,
  caseId: string,
  hiddenAt: number
): void {
  for (const document of allDocuments(snapshots)) {
    const data = document.data() as MediaVisibilityDocument;
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

export function restoreProfileMediaVisibility(
  transaction: Transaction,
  snapshots: ProfileMediaVisibilitySnapshots,
  caseId: string,
  restoredAt: number
): void {
  for (const document of allDocuments(snapshots)) {
    const data = document.data() as MediaVisibilityDocument;
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
  snapshots: ProfileMediaVisibilitySnapshots
): readonly DocumentSnapshot[] {
  return [
    ...snapshots.publicPhotos.docs,
    ...snapshots.publicVideos.docs,
    ...snapshots.photoPublications.docs,
    ...snapshots.videoPublications.docs,
  ];
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
