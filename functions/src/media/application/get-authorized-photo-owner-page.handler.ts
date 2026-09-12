import { FieldPath } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { resolveSocialConnectionAccess } from '../../friendship/application/social-connection-access.policy';
import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';

interface AuthorizedPhotoOwnerPageCursorInput {
  publishedAt?: unknown;
  documentPath?: unknown;
}

interface AuthorizedPhotoOwnerPageRequest {
  ownerUids?: unknown;
  pageSize?: unknown;
  cursor?: AuthorizedPhotoOwnerPageCursorInput | null;
}

interface AuthorizedPhotoOwnerPageCursor {
  publishedAt: number;
  documentPath: string;
}

interface AuthorizedPhotoOwnerPageItem {
  readonly id: string;
  readonly ownerUid: string;
  readonly [key: string]: unknown;
}

interface AuthorizedPhotoOwnerPageResponse {
  items: AuthorizedPhotoOwnerPageItem[];
  nextCursor: AuthorizedPhotoOwnerPageCursor | null;
  hasMore: boolean;
}

interface RawPhotoDocument {
  id: string;
  path: string;
  ownerUid: string;
  publishedAt: number;
  data: FirebaseFirestore.DocumentData;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 24;
const MAX_OWNER_UIDS = 12;
const AUTHORIZED_PHOTO_PAGE_BURST_WINDOW_MS = 60 * 1000;
const AUTHORIZED_PHOTO_PAGE_BURST_MAX_COST = 120;
const AUTHORIZED_PHOTO_PAGE_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const AUTHORIZED_PHOTO_PAGE_SUSTAINED_MAX_COST = 600;
const PHOTO_DOCUMENT_PATH_PATTERN =
  /^public_profiles\/[^/]{1,128}\/public_photos\/[^/]{1,128}$/;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (!normalized || normalized.length > 128 || normalized.includes('/')) {
    return '';
  }

  return normalized;
}

function normalizeOwnerUids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();

  for (const entry of value) {
    const uid = cleanId(entry);
    if (!uid) continue;
    unique.add(uid);
    if (unique.size >= MAX_OWNER_UIDS) break;
  }

  return [...unique];
}

function normalizePageSize(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_PAGE_SIZE);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(parsed)));
}

function normalizeCursor(
  value: AuthorizedPhotoOwnerPageCursorInput | null | undefined
): AuthorizedPhotoOwnerPageCursor | null {
  if (!value) return null;

  const publishedAt = Number(value.publishedAt ?? 0);
  const documentPath = String(value.documentPath ?? '').trim();

  if (
    !Number.isFinite(publishedAt) ||
    publishedAt < 0 ||
    !PHOTO_DOCUMENT_PATH_PATTERN.test(documentPath)
  ) {
    return null;
  }

  return {
    publishedAt: Math.floor(publishedAt),
    documentPath,
  };
}

async function consumeAuthorizedPhotoPageQuota(
  viewerUid: string,
  pageSize: number
): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'getAuthorizedPhotoOwnerPage',
    subject: viewerUid,
    cost: pageSize,
    config: {
      burstWindowMs: AUTHORIZED_PHOTO_PAGE_BURST_WINDOW_MS,
      burstMax: AUTHORIZED_PHOTO_PAGE_BURST_MAX_COST,
      sustainedWindowMs: AUTHORIZED_PHOTO_PAGE_SUSTAINED_WINDOW_MS,
      sustainedMax: AUTHORIZED_PHOTO_PAGE_SUSTAINED_MAX_COST,
    },
    message: 'Muitas publicações foram solicitadas em pouco tempo.',
  });
}

async function resolveExistingPublicProfileOwnerUids(
  ownerUids: readonly string[]
): Promise<Set<string>> {
  if (!ownerUids.length) return new Set<string>();

  const snapshots = await db.getAll(
    ...ownerUids.map((ownerUid) => db.doc(`public_profiles/${ownerUid}`))
  );
  const existing = new Set<string>();

  ownerUids.forEach((ownerUid, index) => {
    if (snapshots[index]?.exists === true) {
      existing.add(ownerUid);
    }
  });

  return existing;
}

async function loadVisibilityPage(input: {
  ownerUids: readonly string[];
  visibility: 'PUBLIC' | 'FRIENDS';
  pageSize: number;
  cursor: AuthorizedPhotoOwnerPageCursor | null;
}): Promise<RawPhotoDocument[]> {
  if (!input.ownerUids.length) return [];

  let photoQuery = db
    .collectionGroup('public_photos')
    .where('ownerUid', 'in', [...input.ownerUids])
    .where('moderationStatus', '==', 'APPROVED')
    .where('visibility', '==', input.visibility)
    .orderBy('publishedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');

  if (input.cursor) {
    photoQuery = photoQuery.startAfter(
      input.cursor.publishedAt,
      db.doc(input.cursor.documentPath)
    );
  }

  const snapshot = await photoQuery.limit(input.pageSize + 1).get();

  return snapshot.docs.flatMap((document) => {
    const data = document.data();
    const ownerUid = cleanId(data?.ownerUid);
    const publishedAt = Number(data?.publishedAt ?? 0);

    if (!ownerUid || !Number.isFinite(publishedAt) || publishedAt < 0) {
      return [];
    }

    return [{
      id: document.id,
      path: document.ref.path,
      ownerUid,
      publishedAt: Math.floor(publishedAt),
      data,
    }];
  });
}

export function compareAuthorizedPhotoDocuments(
  left: Pick<RawPhotoDocument, 'path' | 'publishedAt'>,
  right: Pick<RawPhotoDocument, 'path' | 'publishedAt'>
): number {
  if (left.publishedAt !== right.publishedAt) {
    return right.publishedAt - left.publishedAt;
  }

  if (left.path === right.path) return 0;
  return left.path < right.path ? 1 : -1;
}

export const getAuthorizedPhotoOwnerPage = onCall<AuthorizedPhotoOwnerPageRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request): Promise<AuthorizedPhotoOwnerPageResponse> => {
    assertPublicMediaCallableAppCheck(request.app);

    const viewerUid = cleanId(request.auth?.uid);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const ownerUids = normalizeOwnerUids(request.data?.ownerUids);
    const pageSize = normalizePageSize(request.data?.pageSize);
    const cursor = normalizeCursor(request.data?.cursor);

    if (!ownerUids.length) {
      throw new HttpsError(
        'invalid-argument',
        `Informe entre 1 e ${MAX_OWNER_UIDS} autores válidos.`
      );
    }

    await consumeAuthorizedPhotoPageQuota(viewerUid, pageSize);
    await assertPublicMediaConsumptionAccess(viewerUid);

    try {
      const [existingOwnerUids, socialAccess] = await Promise.all([
        resolveExistingPublicProfileOwnerUids(ownerUids),
        resolveSocialConnectionAccess(viewerUid, ownerUids),
      ]);
      const publicOwnerUids = ownerUids.filter(
        (ownerUid) =>
          existingOwnerUids.has(ownerUid) &&
          !socialAccess.blockedTargetUids.has(ownerUid)
      );
      const friendOwnerUids = publicOwnerUids.filter(
        (ownerUid) =>
          ownerUid === viewerUid || socialAccess.friendTargetUids.has(ownerUid)
      );
      const [publicDocuments, friendDocuments] = await Promise.all([
        loadVisibilityPage({
          ownerUids: publicOwnerUids,
          visibility: 'PUBLIC',
          pageSize,
          cursor,
        }),
        loadVisibilityPage({
          ownerUids: friendOwnerUids,
          visibility: 'FRIENDS',
          pageSize,
          cursor,
        }),
      ]);
      const merged = [
        ...new Map(
          [...publicDocuments, ...friendDocuments].map((document) => [
            document.path,
            document,
          ])
        ).values(),
      ].sort(compareAuthorizedPhotoDocuments);
      const hasMore = merged.length > pageSize;
      const pageDocuments = merged.slice(0, pageSize);
      const lastDocument = pageDocuments.at(-1) ?? null;

      return {
        items: pageDocuments.map((document) => ({
          ...document.data,
          id: document.id,
          ownerUid: document.ownerUid,
        })),
        nextCursor: hasMore && lastDocument
          ? {
              publishedAt: lastDocument.publishedAt,
              documentPath: lastDocument.path,
            }
          : null,
        hasMore,
      };
    } catch (error) {
      logger.warn(
        '[getAuthorizedPhotoOwnerPage] Falha ao resolver página autorizada.',
        {
          viewerUid,
          ownerCount: ownerUids.length,
          pageSize,
          hasCursor: !!cursor,
          error: error instanceof Error
            ? error.message
            : String(error ?? ''),
        }
      );

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        'internal',
        'Não foi possível carregar as publicações neste momento.'
      );
    }
  }
);
