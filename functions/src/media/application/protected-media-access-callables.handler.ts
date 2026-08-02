import { createHash } from 'node:crypto';

import { onCall } from 'firebase-functions/v2/https';

import { PROTECTED_CALLABLE_OPTIONS } from '../../config/protected-callable-options';
import {
  getPrivateVideoAccessUrls as getPrivateVideoAccessUrlsCore,
} from './get-private-video-access-urls.handler';
import {
  getPublicPhotoAccessUrls as getPublicPhotoAccessUrlsCore,
} from './get-public-photo-access-urls.handler';
import {
  getPublicVideoAccessUrls as getPublicVideoAccessUrlsCore,
} from './get-public-video-access-urls.handler';
import {
  listAuthorizedPublicVideos as listAuthorizedPublicVideosCore,
} from './list-authorized-public-videos.handler';
import {
  assertMediaCallableRateLimit,
} from './media-callable-rate-limit.service';

interface PrivateVideoAccessRequest {
  ownerUid?: string;
  videoIds?: string[];
}

interface PublicPhotoAccessRequestItem {
  ownerUid?: string;
  photoId?: string;
}

interface PublicPhotoAccessRequest {
  items?: PublicPhotoAccessRequestItem[];
}

interface PublicVideoAccessRequestItem {
  ownerUid?: string;
  videoId?: string;
}

interface PublicVideoAccessRequest {
  items?: PublicVideoAccessRequestItem[];
}

interface RankingCursor {
  mode: 'top' | 'latest';
  score: number;
  uniqueViewersCount: number;
  viewsCount: number;
  publishedAt: number;
  documentPath: string;
}

interface RankingRequest {
  mode?: unknown;
  pageSize?: unknown;
  cursor?: Partial<RankingCursor> | null;
}

const MAX_PRIVATE_VIDEO_ITEMS = 60;
const MAX_PUBLIC_PHOTO_ITEMS = 32;
const MAX_PUBLIC_VIDEO_ITEMS = 16;
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 16;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function fingerprint(parts: string[]): string {
  const normalized = parts.filter(Boolean).sort();
  const payload = normalized.length ? normalized.join('|') : 'invalid';
  return createHash('sha256').update(payload).digest('hex');
}

function boundedRawCost(value: unknown, max: number): number {
  return Array.isArray(value)
    ? Math.max(1, Math.min(max, value.length))
    : 1;
}

function privateVideoFingerprint(request: PrivateVideoAccessRequest): string {
  const ownerUid = cleanId(request.ownerUid) || 'invalid-owner';
  const videoIds = Array.isArray(request.videoIds)
    ? [...new Set(request.videoIds.map(cleanId).filter(Boolean))]
    : [];

  return `private-video:${ownerUid}:${fingerprint(videoIds)}`;
}

function publicPhotoFingerprint(request: PublicPhotoAccessRequest): string {
  const items = Array.isArray(request.items) ? request.items : [];
  const keys = items.flatMap((item) => {
    const ownerUid = cleanId(item?.ownerUid);
    const photoId = cleanId(item?.photoId);
    return ownerUid && photoId ? [`${ownerUid}:${photoId}`] : [];
  });

  return `public-photo:${fingerprint([...new Set(keys)])}`;
}

function publicVideoFingerprint(request: PublicVideoAccessRequest): string {
  const items = Array.isArray(request.items) ? request.items : [];
  const keys = items.flatMap((item) => {
    const ownerUid = cleanId(item?.ownerUid);
    const videoId = cleanId(item?.videoId);
    return ownerUid && videoId ? [`${ownerUid}:${videoId}`] : [];
  });

  return `public-video:${fingerprint([...new Set(keys)])}`;
}

function normalizePageSize(value: unknown): number {
  const numeric = Number(value ?? DEFAULT_PAGE_SIZE);

  return Number.isFinite(numeric)
    ? Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(numeric)))
    : DEFAULT_PAGE_SIZE;
}

function normalizeMode(value: unknown): 'top' | 'latest' {
  return String(value ?? '').trim().toLowerCase() === 'top'
    ? 'top'
    : 'latest';
}

export const getPrivateVideoAccessUrls = onCall<PrivateVideoAccessRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    const actorUid = cleanId(request.auth?.uid);

    if (actorUid) {
      await assertMediaCallableRateLimit({
        actorUid,
        action: 'ACCESS_PRIVATE',
        resourceKey: privateVideoFingerprint(request.data ?? {}),
        cost: boundedRawCost(
          request.data?.videoIds,
          MAX_PRIVATE_VIDEO_ITEMS
        ),
      });
    }

    return getPrivateVideoAccessUrlsCore.run(request);
  }
);

export const getPublicPhotoAccessUrls = onCall<PublicPhotoAccessRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    const actorUid = cleanId(request.auth?.uid);

    if (actorUid) {
      await assertMediaCallableRateLimit({
        actorUid,
        action: 'ACCESS_PUBLIC',
        resourceKey: publicPhotoFingerprint(request.data ?? {}),
        cost: boundedRawCost(
          request.data?.items,
          MAX_PUBLIC_PHOTO_ITEMS
        ),
      });
    }

    return getPublicPhotoAccessUrlsCore.run(request);
  }
);

export const getPublicVideoAccessUrls = onCall<PublicVideoAccessRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    const actorUid = cleanId(request.auth?.uid);

    if (actorUid) {
      await assertMediaCallableRateLimit({
        actorUid,
        action: 'ACCESS_PUBLIC',
        resourceKey: publicVideoFingerprint(request.data ?? {}),
        cost: boundedRawCost(
          request.data?.items,
          MAX_PUBLIC_VIDEO_ITEMS
        ),
      });
    }

    return getPublicVideoAccessUrlsCore.run(request);
  }
);

export const listAuthorizedPublicVideos = onCall<RankingRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    const actorUid = cleanId(request.auth?.uid);
    const mode = normalizeMode(request.data?.mode);
    const pageSize = normalizePageSize(request.data?.pageSize);

    if (actorUid) {
      await assertMediaCallableRateLimit({
        actorUid,
        action: 'LIST_PUBLIC',
        resourceKey: `public-video-feed:${mode}`,
        cost: pageSize,
      });
    }

    return listAuthorizedPublicVideosCore.run(request);
  }
);
