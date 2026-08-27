import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  resolveBlockedTargetUids,
} from '../../friendship/application/bilateral-block-access.policy';
import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';
import { isRecentPublicMediaView } from './recent-public-media-view.policy';

type RecentPublicMediaType = 'PHOTO' | 'VIDEO';

interface RecentPublicMediaViewRequestItem {
  mediaType?: unknown;
  ownerUid?: unknown;
  mediaId?: unknown;
}

interface RecentPublicMediaViewRequest {
  items?: RecentPublicMediaViewRequestItem[];
}

interface RecentPublicMediaViewResponseItem {
  mediaType: RecentPublicMediaType;
  ownerUid: string;
  mediaId: string;
}

interface RecentPublicMediaViewResponse {
  items: RecentPublicMediaViewResponseItem[];
}

const MAX_ITEMS_PER_REQUEST = 48;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const BURST_WINDOW_MS = 60 * 1000;
const BURST_MAX_ITEMS = 192;
const SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const SUSTAINED_MAX_ITEMS = 960;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

function cleanMediaType(value: unknown): RecentPublicMediaType | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'PHOTO' || normalized === 'VIDEO'
    ? normalized
    : null;
}

function requestKey(item: RecentPublicMediaViewResponseItem): string {
  return JSON.stringify([item.mediaType, item.ownerUid, item.mediaId]);
}

function mediaDocumentPath(item: RecentPublicMediaViewResponseItem): string {
  const collectionName = item.mediaType === 'PHOTO'
    ? 'public_photos'
    : 'public_videos';

  return `public_profiles/${item.ownerUid}/${collectionName}/${item.mediaId}`;
}

function isCurrentlyPublicApproved(
  exists: boolean,
  data: FirebaseFirestore.DocumentData | undefined
): boolean {
  return (
    exists &&
    data?.visibility === 'PUBLIC' &&
    data?.moderationStatus === 'APPROVED'
  );
}

async function consumeQuota(viewerUid: string, itemCount: number): Promise<void> {
  await consumeBackendRateLimitQuota({
    action: 'getRecentPublicMediaViews',
    subject: viewerUid,
    cost: itemCount,
    config: {
      burstWindowMs: BURST_WINDOW_MS,
      burstMax: BURST_MAX_ITEMS,
      sustainedWindowMs: SUSTAINED_WINDOW_MS,
      sustainedMax: SUSTAINED_MAX_ITEMS,
    },
    message: 'Muitas atualizações de novidade foram solicitadas em pouco tempo.',
  });
}

export const getRecentPublicMediaViews = onCall<RecentPublicMediaViewRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request): Promise<RecentPublicMediaViewResponse> => {
    assertPublicMediaCallableAppCheck(request.app);

    const viewerUid = cleanId(request.auth?.uid);
    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const rawItems = Array.isArray(request.data?.items)
      ? request.data.items
      : [];

    if (!rawItems.length || rawItems.length > MAX_ITEMS_PER_REQUEST) {
      throw new HttpsError(
        'invalid-argument',
        `Informe entre 1 e ${MAX_ITEMS_PER_REQUEST} mídias.`
      );
    }

    const uniqueItems = new Map<string, RecentPublicMediaViewResponseItem>();

    for (const rawItem of rawItems) {
      const mediaType = cleanMediaType(rawItem?.mediaType);
      const ownerUid = cleanId(rawItem?.ownerUid);
      const mediaId = cleanId(rawItem?.mediaId);

      if (!mediaType || !ownerUid || !mediaId) {
        continue;
      }

      const item = { mediaType, ownerUid, mediaId };
      uniqueItems.set(requestKey(item), item);
    }

    if (!uniqueItems.size) {
      throw new HttpsError(
        'invalid-argument',
        'Nenhuma mídia válida informada.'
      );
    }

    await consumeQuota(viewerUid, uniqueItems.size);
    await assertPublicMediaConsumptionAccess(viewerUid);

    const ownerUids = [
      ...new Set([...uniqueItems.values()].map((item) => item.ownerUid)),
    ];
    let blockedOwnerUids: Set<string>;

    try {
      blockedOwnerUids = await resolveBlockedTargetUids(viewerUid, ownerUids);
    } catch (error) {
      logger.warn(
        '[getRecentPublicMediaViews] Falha ao validar bloqueios bilaterais.',
        {
          viewerUid,
          ownerCount: ownerUids.length,
          error: error instanceof Error
            ? error.message
            : String(error ?? ''),
        }
      );

      throw new HttpsError(
        'internal',
        'Não foi possível atualizar a novidade do fluxo neste momento.'
      );
    }

    const candidates = [...uniqueItems.values()].filter(
      (item) =>
        item.ownerUid !== viewerUid &&
        !blockedOwnerUids.has(item.ownerUid)
    );

    if (!candidates.length) {
      return { items: [] };
    }

    const refs = candidates.flatMap((item) => {
      const mediaPath = mediaDocumentPath(item);
      return [
        db.doc(mediaPath),
        db.doc(`${mediaPath}/views/${viewerUid}`),
      ];
    });

    let snapshots: FirebaseFirestore.DocumentSnapshot[];

    try {
      snapshots = await db.getAll(...refs);
    } catch (error) {
      logger.warn('[getRecentPublicMediaViews] Falha na leitura em lote.', {
        viewerUid,
        candidateCount: candidates.length,
        error: error instanceof Error
          ? error.message
          : String(error ?? ''),
      });

      throw new HttpsError(
        'internal',
        'Não foi possível atualizar a novidade do fluxo neste momento.'
      );
    }

    const items: RecentPublicMediaViewResponseItem[] = [];
    const now = Date.now();

    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index];
      const mediaSnapshot = snapshots[index * 2];
      const viewSnapshot = snapshots[index * 2 + 1];

      if (
        !mediaSnapshot ||
        !viewSnapshot ||
        !isCurrentlyPublicApproved(
          mediaSnapshot.exists,
          mediaSnapshot.data()
        ) ||
        !viewSnapshot.exists
      ) {
        continue;
      }

      const viewData = viewSnapshot.data();
      const storedViewerUid = cleanId(viewData?.viewerUid);

      if (storedViewerUid && storedViewerUid !== viewerUid) {
        continue;
      }

      if (!isRecentPublicMediaView({
        lastViewedAt: viewData?.lastViewedAt,
        now,
      })) {
        continue;
      }

      items.push(item);
    }

    return { items };
  }
);
