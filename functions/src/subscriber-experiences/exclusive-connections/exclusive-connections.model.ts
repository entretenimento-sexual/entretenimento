// functions/src/subscriber-experiences/exclusive-connections/exclusive-connections.model.ts
// -----------------------------------------------------------------------------
// EXCLUSIVE CONNECTIONS CONTRACT
// -----------------------------------------------------------------------------
// Projeção sanitizada e paginável para a experiência de assinantes.
//
// Não inclui:
// - localização precisa;
// - e-mail, telefone ou identificadores financeiros;
// - dados privados de perfil;
// - payloads livres não moderados.
// -----------------------------------------------------------------------------

export const EXCLUSIVE_CONNECTIONS_DEFAULT_PAGE_SIZE = 12;
export const EXCLUSIVE_CONNECTIONS_MAX_PAGE_SIZE = 24;

export interface ExclusiveConnectionCard {
  candidateUid: string;
  nickname: string;
  photoURL: string | null;
  region: {
    uf: string;
    city: string;
  };
  compatibilityScore: number;
  intentLabel: string;
  reasonTags: string[];
}

export interface ExclusiveConnectionsPageResponse {
  items: ExclusiveConnectionCard[];
  nextCursor: string | null;
  generatedAt: number;
}

export interface ExclusiveConnectionsPageRequest {
  limit?: unknown;
  cursor?: unknown;
}

export interface NormalizedExclusiveConnectionsPageRequest {
  limit: number;
  cursor: string | null;
}

interface CandidateProjectionData {
  candidateUid?: unknown;
  nickname?: unknown;
  photoURL?: unknown;
  region?: {
    uf?: unknown;
    city?: unknown;
  } | null;
  compatibilityScore?: unknown;
  intentLabel?: unknown;
  reasonTags?: unknown;
  status?: unknown;
  expiresAt?: unknown;
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function normalizeHttpsUrl(value: unknown): string | null {
  const raw = normalizeText(value, 2_000);

  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeReasonTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueTags = new Set<string>();

  for (const rawTag of value) {
    const tag = normalizeText(rawTag, 32);

    if (tag.length >= 2) {
      uniqueTags.add(tag);
    }

    if (uniqueTags.size >= 3) {
      break;
    }
  }

  return [...uniqueTags];
}

export function normalizeExclusiveConnectionsPageRequest(
  rawRequest: ExclusiveConnectionsPageRequest | null | undefined
): NormalizedExclusiveConnectionsPageRequest {
  const parsedLimit = Number(rawRequest?.limit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(
        Math.max(Math.trunc(parsedLimit), 1),
        EXCLUSIVE_CONNECTIONS_MAX_PAGE_SIZE
      )
    : EXCLUSIVE_CONNECTIONS_DEFAULT_PAGE_SIZE;

  const rawCursor = normalizeText(rawRequest?.cursor, 128);
  const cursor = rawCursor && /^[A-Za-z0-9:_-]+$/.test(rawCursor)
    ? rawCursor
    : null;

  return { limit, cursor };
}

export function sanitizeExclusiveConnectionCandidate(
  documentId: string,
  rawData: CandidateProjectionData | null | undefined,
  now = Date.now()
): ExclusiveConnectionCard | null {
  const data = rawData ?? {};
  const candidateUid = normalizeText(data.candidateUid, 128);
  const nickname = normalizeText(data.nickname, 40);
  const uf = normalizeText(data.region?.uf, 2).toUpperCase();
  const city = normalizeText(data.region?.city, 80);
  const compatibilityScore = Number(data.compatibilityScore);
  const intentLabel = normalizeText(data.intentLabel, 80);
  const expiresAt = Number(data.expiresAt);

  if (
    data.status !== 'active'
    || candidateUid !== documentId
    || !/^[A-Za-z0-9:_-]{1,128}$/.test(candidateUid)
    || nickname.length < 1
    || !/^[A-Z]{2}$/.test(uf)
    || city.length < 1
    || !Number.isFinite(compatibilityScore)
    || compatibilityScore < 0
    || compatibilityScore > 100
    || intentLabel.length < 1
    || !Number.isFinite(expiresAt)
    || expiresAt <= now
  ) {
    return null;
  }

  return {
    candidateUid,
    nickname,
    photoURL: normalizeHttpsUrl(data.photoURL),
    region: { uf, city },
    compatibilityScore: Math.round(compatibilityScore),
    intentLabel,
    reasonTags: normalizeReasonTags(data.reasonTags),
  };
}
