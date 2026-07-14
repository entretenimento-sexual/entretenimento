import type {
  IPublicVideoAccess,
  IPublicVideoItem,
  IPublicVideoOwnerSummary,
  IPublicVideoProjection,
  IPublicVideoScoreBreakdown,
  TPublicVideoPosterAccess,
} from 'src/app/core/interfaces/media/i-public-video-item';

interface PublicVideoMapperInput {
  readonly documentId: unknown;
  readonly data: unknown;
  readonly expectedOwnerUid?: unknown;
}

const SUPPORTED_PUBLIC_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
const ACCESS_EXPIRY_SAFETY_WINDOW_MS = 15_000;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
}

function normalizeId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeText(
  value: unknown,
  maxLength: number,
  fallback: string | null = null
): string | null {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

  return normalized || fallback;
}

function normalizeCount(value: unknown): number {
  const numberValue = Number(value ?? 0);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : 0;
}

function normalizeScore(value: unknown): number {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function normalizeRatingAverage(value: unknown): number {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.max(0, Math.min(5, Number(numberValue.toFixed(2))));
}

function normalizePositiveInteger(value: unknown): number {
  const numberValue = Number(value ?? 0);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : 0;
}

function normalizeDateMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (value instanceof Date) {
    const dateMs = value.getTime();
    return Number.isFinite(dateMs) && dateMs > 0 ? dateMs : null;
  }

  const timestamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: number;
  } | null | undefined;

  if (typeof timestamp?.toMillis === 'function') {
    try {
      return normalizeDateMs(timestamp.toMillis());
    } catch {
      return null;
    }
  }

  if (typeof timestamp?.toDate === 'function') {
    try {
      return normalizeDateMs(timestamp.toDate());
    } catch {
      return null;
    }
  }

  if (typeof timestamp?.seconds === 'number') {
    return normalizeDateMs(timestamp.seconds * 1000);
  }

  return null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeMimeType(value: unknown): string {
  const mimeType = String(value ?? '').trim().toLowerCase();
  return SUPPORTED_PUBLIC_VIDEO_TYPES.has(mimeType) ? mimeType : '';
}

function normalizePosterAccess(value: unknown): TPublicVideoPosterAccess {
  return String(value ?? '').trim().toUpperCase() === 'SIGNED_URL'
    ? 'SIGNED_URL'
    : 'NONE';
}

function normalizeOwnerSummary(
  data: Record<string, unknown>
): IPublicVideoOwnerSummary | null {
  const nickname = normalizeText(
    data['ownerNickname'] ?? data['nickname'],
    40
  );
  const photoURL = normalizeText(
    data['ownerPhotoURL'] ?? data['photoURL'],
    2048
  );
  const gender = normalizeText(data['ownerGender'], 40);
  const orientation = normalizeText(data['ownerOrientation'], 40);
  const municipio = normalizeText(data['ownerMunicipio'], 120);
  const estado = normalizeText(data['ownerEstado'], 80);

  if (!nickname && !photoURL && !gender && !orientation && !municipio && !estado) {
    return null;
  }

  return {
    nickname,
    photoURL,
    gender,
    orientation,
    municipio,
    estado,
  };
}

function normalizeScoreBreakdown(
  value: unknown,
  fallbackScore: number,
  fallbackEngagementScore: number
): IPublicVideoScoreBreakdown {
  const data = asRecord(value);

  return {
    rankingScore: normalizeScore(data['rankingScore'] ?? fallbackScore),
    qualityScore: normalizeScore(data['qualityScore']),
    engagementScore: normalizeScore(
      data['engagementScore'] ?? fallbackEngagementScore
    ),
    safetyScore: normalizeScore(data['safetyScore'] ?? 100),
  };
}

function isTemporaryUrl(value: unknown): value is string {
  const url = String(value ?? '').trim();

  if (!url || url.length > 4096) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function buildPublicVideoKey(ownerUid: string, videoId: string): string {
  return `${ownerUid}:${videoId}`;
}

/**
 * Converte um documento Firestore em projeção pública canônica.
 * Estados não públicos, não aprovados ou incompletos são descartados.
 */
export function mapPublicVideoProjection(
  input: PublicVideoMapperInput
): IPublicVideoProjection | null {
  const data = asRecord(input.data);
  const id = normalizeId(data['id'] ?? input.documentId);
  const ownerUid = normalizeId(data['ownerUid'] ?? input.expectedOwnerUid);
  const expectedOwnerUid = normalizeId(input.expectedOwnerUid);
  const visibility = String(data['visibility'] ?? '').trim().toUpperCase();
  const moderationStatus = String(
    data['moderationStatus'] ?? ''
  ).trim().toUpperCase();
  const mediaType = String(data['mediaType'] ?? 'VIDEO').trim().toUpperCase();
  const mimeType = normalizeMimeType(data['mimeType']);
  const durationMs = normalizePositiveInteger(data['durationMs']);
  const sizeBytes = normalizePositiveInteger(data['sizeBytes']);
  const publishedAt = normalizeDateMs(data['publishedAt']);

  if (
    !id ||
    !ownerUid ||
    (expectedOwnerUid && ownerUid !== expectedOwnerUid) ||
    visibility !== 'PUBLIC' ||
    moderationStatus !== 'APPROVED' ||
    mediaType !== 'VIDEO' ||
    !mimeType ||
    !durationMs ||
    !sizeBytes ||
    !publishedAt
  ) {
    return null;
  }

  const createdAt = normalizeDateMs(data['createdAt']) ?? publishedAt;
  const updatedAt = normalizeDateMs(data['updatedAt']) ?? publishedAt;
  const lastViewedAt = normalizeDateMs(data['lastViewedAt']);
  const reactionsCount = normalizeCount(
    data['reactionsCount'] ?? data['likesCount']
  );
  const engagementScore = normalizeScore(data['engagementScore']);
  const score = normalizeScore(data['score']);

  return {
    id,
    ownerUid,
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: normalizePosterAccess(data['posterAccess']),
    title: normalizeText(data['title'], 120, 'Vídeo do perfil')!,
    description: normalizeText(data['description'], 1000),
    alt: normalizeText(
      data['alt'],
      240,
      'Vídeo publicado no perfil'
    )!,
    mimeType,
    sizeBytes,
    durationMs,
    createdAt,
    publishedAt,
    updatedAt,
    lastViewedAt,
    visibility: 'PUBLIC',
    orderIndex: Math.min(10_000, normalizeCount(data['orderIndex'])),
    moderationStatus: 'APPROVED',
    moderationReason: normalizeText(data['moderationReason'], 500),
    reactionsEnabled: normalizeBoolean(data['reactionsEnabled'], true),
    commentsEnabled: normalizeBoolean(data['commentsEnabled'], true),
    ratingsEnabled: normalizeBoolean(data['ratingsEnabled'], true),
    viewsCount: normalizeCount(data['viewsCount']),
    uniqueViewersCount: normalizeCount(data['uniqueViewersCount']),
    reactionsCount,
    commentsCount: normalizeCount(data['commentsCount']),
    ratingsCount: normalizeCount(data['ratingsCount']),
    ratingAverage: normalizeRatingAverage(data['ratingAverage']),
    reportsCount: normalizeCount(data['reportsCount']),
    openReportsCount: normalizeCount(data['openReportsCount']),
    confirmedReportsCount: normalizeCount(data['confirmedReportsCount']),
    viewScore: normalizeScore(data['viewScore']),
    engagementScore,
    score,
    scoreBreakdown: normalizeScoreBreakdown(
      data['scoreBreakdown'],
      score,
      engagementScore
    ),
    owner: normalizeOwnerSummary(data),
  };
}

export function isPublicVideoAccessUsable(
  projection: IPublicVideoProjection,
  access: IPublicVideoAccess | null | undefined,
  now = Date.now()
): access is IPublicVideoAccess {
  return !!access &&
    access.ownerUid === projection.ownerUid &&
    access.videoId === projection.id &&
    isTemporaryUrl(access.url) &&
    (!access.posterUrl || isTemporaryUrl(access.posterUrl)) &&
    Number.isFinite(access.expiresAt) &&
    access.expiresAt > now + ACCESS_EXPIRY_SAFETY_WINDOW_MS;
}

export function hydratePublicVideoItem(
  projection: IPublicVideoProjection,
  access: IPublicVideoAccess,
  now = Date.now()
): IPublicVideoItem | null {
  if (!isPublicVideoAccessUsable(projection, access, now)) {
    return null;
  }

  return {
    ...projection,
    url: access.url.trim(),
    posterUrl: access.posterUrl?.trim() || null,
    accessExpiresAt: Math.floor(access.expiresAt),
  };
}
