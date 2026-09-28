import {
  OFFICIAL_MEDIA_CONTEXT_TARGET_TYPES,
  type IOfficialMediaContextEntry,
  type IOfficialMediaContextProjection,
  type TOfficialMediaContextTargetType,
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

function normalizeType(value: unknown): TOfficialMediaContextTargetType | null {
  return OFFICIAL_MEDIA_CONTEXT_TARGET_TYPES.includes(
    value as TOfficialMediaContextTargetType
  )
    ? value as TOfficialMediaContextTargetType
    : null;
}

function normalizeEntry(raw: unknown): IOfficialMediaContextEntry | null {
  const source = asRecord(raw);
  const identity = asRecord(source['identity']);
  const association = asRecord(source['association']);
  const target = asRecord(source['target']);
  const identityType = normalizeType(identity['type']);
  const targetType = normalizeType(target['type']);
  const targetId = safeId(target['id']);

  if (
    identity['verified'] !== true
    || association['verified'] !== true
    || !identityType
    || !targetType
    || identityType !== targetType
    || !targetId
  ) {
    return null;
  }

  return {
    identity: { verified: true, type: identityType },
    association: { verified: true },
    target: { type: targetType, id: targetId },
  };
}

/**
 * Normaliza apenas a projeção destinada à apresentação.
 * Não concede nem revalida autoridade no cliente.
 *
 * O formato legado de Profile é aceito somente para reidratação segura durante
 * a migração; toda saída normalizada usa `contexts[]`.
 */
export function normalizeOfficialMediaContextProjection(
  raw: unknown
): IOfficialMediaContextProjection | null {
  const source = asRecord(raw);
  const rawContexts = Array.isArray(source['contexts'])
    ? source['contexts']
    : source['target']
      ? [raw]
      : [];

  const contexts = rawContexts
    .map(normalizeEntry)
    .filter((entry): entry is IOfficialMediaContextEntry => entry !== null);

  if (contexts.length !== rawContexts.length || contexts.length === 0) {
    return null;
  }

  const unique = new Map<string, IOfficialMediaContextEntry>();
  for (const entry of contexts) {
    unique.set(`${entry.target.type}:${entry.target.id}`, entry);
  }

  return {
    contexts: [...unique.values()],
  };
}

export function isOfficialMediaContextProjection(
  raw: unknown
): raw is IOfficialMediaContextProjection {
  return normalizeOfficialMediaContextProjection(raw) !== null;
}
