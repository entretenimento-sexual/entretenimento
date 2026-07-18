// src/app/subscriber-experiences/exclusive-connections/exclusive-connections.model.ts
// -----------------------------------------------------------------------------
// EXCLUSIVE CONNECTIONS CLIENT CONTRACT
// -----------------------------------------------------------------------------
// Contrato sanitizado recebido da callable. O frontend normaliza novamente a
// resposta para não confiar em payload remoto incompleto ou inesperado.
// -----------------------------------------------------------------------------

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
  reasonTags: readonly string[];
}

export interface ExclusiveConnectionsPage {
  items: readonly ExclusiveConnectionCard[];
  nextCursor: string | null;
  generatedAt: number;
}

export interface ExclusiveConnectionsPageRequest {
  limit?: number;
  cursor?: string | null;
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

function normalizeCard(raw: unknown): ExclusiveConnectionCard | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const region = (source['region'] ?? {}) as Record<string, unknown>;
  const candidateUid = normalizeText(source['candidateUid'], 128);
  const nickname = normalizeText(source['nickname'], 40);
  const uf = normalizeText(region['uf'], 2).toUpperCase();
  const city = normalizeText(region['city'], 80);
  const compatibilityScore = Number(source['compatibilityScore']);
  const intentLabel = normalizeText(source['intentLabel'], 80);

  if (
    !/^[A-Za-z0-9:_-]{1,128}$/.test(candidateUid)
    || nickname.length < 1
    || !/^[A-Z]{2}$/.test(uf)
    || city.length < 1
    || !Number.isFinite(compatibilityScore)
    || compatibilityScore < 0
    || compatibilityScore > 100
    || intentLabel.length < 1
  ) {
    return null;
  }

  const reasonTags = Array.isArray(source['reasonTags'])
    ? [...new Set(
        source['reasonTags']
          .map((tag) => normalizeText(tag, 32))
          .filter((tag) => tag.length >= 2)
      )].slice(0, 3)
    : [];

  return {
    candidateUid,
    nickname,
    photoURL: normalizeHttpsUrl(source['photoURL']),
    region: { uf, city },
    compatibilityScore: Math.round(compatibilityScore),
    intentLabel,
    reasonTags,
  };
}

export function normalizeExclusiveConnectionsPageResponse(
  raw: unknown
): ExclusiveConnectionsPage {
  const source = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(source['items'])
    ? source['items']
        .map(normalizeCard)
        .filter((item): item is ExclusiveConnectionCard => item !== null)
    : [];
  const rawCursor = normalizeText(source['nextCursor'], 128);
  const nextCursor = rawCursor && /^[A-Za-z0-9:_-]+$/.test(rawCursor)
    ? rawCursor
    : null;
  const generatedAt = Number(source['generatedAt']);

  return {
    items,
    nextCursor,
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
  };
}
