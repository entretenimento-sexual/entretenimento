import type {
  DocumentSnapshot,
  QuerySnapshot,
  Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db, FieldValue } from '../firebaseApp';

const MAX_TRANSACTIONAL_MEDIA_DOCUMENTS = 420;
const AGE_REVERIFICATION_VIDEO_REASON =
  'Conteúdo temporariamente indisponível durante reverificação etária.';

type MediaEntryKind =
  | 'PHOTO_PUBLIC'
  | 'VIDEO_PUBLIC'
  | 'PHOTO_PUBLICATION'
  | 'VIDEO_PUBLICATION';

interface MediaVisibilityDocument {
  visibility?: unknown;
  isPublished?: unknown;
  moderationStatus?: unknown;
  moderationReason?: unknown;
  ageReverificationHidden?: unknown;
  ageReverificationCaseId?: unknown;
  ageReverificationPreviousVisibility?: unknown;
  ageReverificationPreviousModerationStatus?: unknown;
  ageReverificationPreviousModerationReason?: unknown;
}

interface MediaVisibilityEntry {
  readonly document: DocumentSnapshot;
  readonly fallbackVisibility: 'PUBLIC' | 'PRIVATE';
  readonly kind: MediaEntryKind;
}

export interface ProfileMediaVisibilitySnapshots {
  readonly publicPhotos: QuerySnapshot;
  readonly publicVideos: QuerySnapshot;
  readonly photoPublications: QuerySnapshot;
  readonly videoPublications: QuerySnapshot;
  readonly totalDocuments: number;
}

type ProfileMediaQueries = Omit<
  ProfileMediaVisibilitySnapshots,
  'totalDocuments'
>;

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
  const queries: ProfileMediaQueries = {
    publicPhotos,
    publicVideos,
    photoPublications,
    videoPublications,
  };
  const totalDocuments = visibilityEntries(queries).length;

  if (totalDocuments > MAX_TRANSACTIONAL_MEDIA_DOCUMENTS) {
    throw new HttpsError(
      'failed-precondition',
      'O perfil possui mais documentos de mídia do que esta revisão pode ' +
        'processar de forma transacional. Encaminhe o caso ao suporte técnico.'
    );
  }

  return {
    ...queries,
    totalDocuments,
  };
}

export function hideProfileMediaVisibility(
  transaction: Transaction,
  snapshots: ProfileMediaVisibilitySnapshots,
  caseId: string,
  hiddenAt: number
): void {
  for (const entry of visibilityEntries(snapshots)) {
    const data = entry.document.data() as MediaVisibilityDocument;
    const currentVisibility = normalizeVisibility(
      data.visibility,
      entry.fallbackVisibility
    );

    if (
      data.ageReverificationHidden === true &&
      String(data.ageReverificationCaseId ?? '').trim() === caseId
    ) {
      continue;
    }

    if (isVideoEntry(entry.kind)) {
      const currentModerationStatus = normalizeVideoModerationStatus(
        data.moderationStatus,
        entry.kind === 'VIDEO_PUBLIC' ? 'APPROVED' : 'PENDING_REVIEW'
      );
      const currentModerationReason = normalizeOptionalText(
        data.moderationReason
      );

      transaction.set(
        entry.document.ref,
        {
          // A restrição etária é uma quarentena de compliance, não um estado
          // de produto "vídeo privado". A visibilidade original é preservada
          // e o bloqueio ocorre pela moderação, que já é fail-closed no acesso.
          visibility: currentVisibility,
          moderationStatus:
            entry.kind === 'VIDEO_PUBLIC' ? 'HIDDEN' : 'FLAGGED',
          moderationReason: AGE_REVERIFICATION_VIDEO_REASON,
          ageReverificationHidden: true,
          ageReverificationCaseId: caseId,
          ageReverificationPreviousVisibility: currentVisibility,
          ageReverificationPreviousModerationStatus: currentModerationStatus,
          ageReverificationPreviousModerationReason: currentModerationReason,
          ageReverificationHiddenAt: hiddenAt,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      continue;
    }

    transaction.set(
      entry.document.ref,
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
  for (const entry of visibilityEntries(snapshots)) {
    const data = entry.document.data() as MediaVisibilityDocument;
    const hiddenByCurrentCase = data.ageReverificationHidden === true &&
      String(data.ageReverificationCaseId ?? '').trim() === caseId;

    if (!hiddenByCurrentCase) {
      continue;
    }

    const restoredVisibility = normalizeVisibility(
      data.ageReverificationPreviousVisibility,
      entry.fallbackVisibility
    );

    if (isVideoEntry(entry.kind)) {
      transaction.set(
        entry.document.ref,
        {
          visibility: restoredVisibility,
          moderationStatus: normalizeVideoModerationStatus(
            data.ageReverificationPreviousModerationStatus,
            entry.kind === 'VIDEO_PUBLIC' ? 'APPROVED' : 'PENDING_REVIEW'
          ),
          moderationReason: normalizeOptionalText(
            data.ageReverificationPreviousModerationReason
          ),
          ageReverificationHidden: FieldValue.delete(),
          ageReverificationCaseId: FieldValue.delete(),
          ageReverificationPreviousVisibility: FieldValue.delete(),
          ageReverificationPreviousModerationStatus: FieldValue.delete(),
          ageReverificationPreviousModerationReason: FieldValue.delete(),
          ageReverificationHiddenAt: FieldValue.delete(),
          ageReverificationRestoredAt: restoredAt,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      continue;
    }

    transaction.set(
      entry.document.ref,
      {
        visibility: restoredVisibility,
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

function visibilityEntries(
  snapshots: ProfileMediaQueries
): readonly MediaVisibilityEntry[] {
  const photoPublicationEntries = snapshots.photoPublications.docs
    .filter(isPublishedOrAgeHidden)
    .map((document) => ({
      document,
      fallbackVisibility: 'PRIVATE' as const,
      kind: 'PHOTO_PUBLICATION' as const,
    }));
  const videoPublicationEntries = snapshots.videoPublications.docs
    .filter(isPublishedOrAgeHidden)
    .map((document) => ({
      document,
      fallbackVisibility: 'PUBLIC' as const,
      kind: 'VIDEO_PUBLICATION' as const,
    }));

  return [
    ...snapshots.publicPhotos.docs.map((document) => ({
      document,
      fallbackVisibility: 'PUBLIC' as const,
      kind: 'PHOTO_PUBLIC' as const,
    })),
    ...snapshots.publicVideos.docs.map((document) => ({
      document,
      fallbackVisibility: 'PUBLIC' as const,
      kind: 'VIDEO_PUBLIC' as const,
    })),
    ...photoPublicationEntries,
    ...videoPublicationEntries,
  ];
}

function isPublishedOrAgeHidden(document: DocumentSnapshot): boolean {
  const data = document.data() as MediaVisibilityDocument;

  return data.isPublished === true || data.ageReverificationHidden === true;
}

function isVideoEntry(kind: MediaEntryKind): boolean {
  return kind === 'VIDEO_PUBLIC' || kind === 'VIDEO_PUBLICATION';
}

function normalizeVisibility(
  value: unknown,
  fallback: 'PUBLIC' | 'PRIVATE'
): string {
  const visibility = String(value ?? '').trim().toUpperCase();

  return [
    'PRIVATE',
    'FRIENDS',
    'SUBSCRIBERS',
    'PREMIUM',
    'PUBLIC',
  ].includes(visibility)
    ? visibility
    : fallback;
}

function normalizeVideoModerationStatus(
  value: unknown,
  fallback: 'APPROVED' | 'PENDING_REVIEW'
): string {
  const status = String(value ?? '').trim().toUpperCase();

  return [
    'PENDING_REVIEW',
    'APPROVED',
    'REJECTED',
    'FLAGGED',
    'HIDDEN',
  ].includes(status)
    ? status
    : fallback;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || null;
}