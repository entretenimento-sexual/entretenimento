import type {
  IOfficialMediaContextProjection,
} from 'src/app/core/interfaces/media/i-official-media-context';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(normalized) ? normalized : '';
}

/**
 * Normaliza apenas a projeção destinada à apresentação.
 * Não concede nem revalida autoridade no cliente.
 */
export function normalizeOfficialMediaContextProjection(
  raw: unknown
): IOfficialMediaContextProjection | null {
  const source = asRecord(raw);
  const identity = asRecord(source['identity']);
  const association = asRecord(source['association']);
  const target = asRecord(source['target']);
  const targetId = safeId(target['id']);

  if (
    identity['verified'] !== true
    || identity['type'] !== 'profile'
    || association['verified'] !== true
    || target['type'] !== 'profile'
    || !targetId
  ) {
    return null;
  }

  return {
    identity: {
      verified: true,
      type: 'profile',
    },
    association: {
      verified: true,
    },
    target: {
      type: 'profile',
      id: targetId,
    },
  };
}

export function isOfficialMediaContextProjection(
  raw: unknown
): raw is IOfficialMediaContextProjection {
  return normalizeOfficialMediaContextProjection(raw) !== null;
}
