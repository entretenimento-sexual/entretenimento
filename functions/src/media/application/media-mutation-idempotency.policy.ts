import { createHash } from 'node:crypto';

const DEFAULT_UPLOAD_COST_UNIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_UPLOAD_MAX_COST = 50;
const DEFAULT_UPLOAD_FALLBACK_COST = 5;

function stableValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    Object.keys(source)
      .sort()
      .forEach((key) => {
        const item = source[key];

        if (item !== undefined && typeof item !== 'function') {
          normalized[key] = stableValue(item);
        }
      });

    return normalized;
  }

  return String(value ?? '');
}

export function hashMediaMutationRequest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

export function resolveUploadMutationCost(
  sizeBytes: unknown,
  options: {
    unitBytes?: number;
    maxCost?: number;
    fallbackCost?: number;
  } = {}
): number {
  const unitBytes = Math.max(
    1,
    Math.floor(options.unitBytes ?? DEFAULT_UPLOAD_COST_UNIT_BYTES)
  );
  const maxCost = Math.max(
    1,
    Math.floor(options.maxCost ?? DEFAULT_UPLOAD_MAX_COST)
  );
  const fallbackCost = Math.max(
    1,
    Math.min(
      maxCost,
      Math.floor(options.fallbackCost ?? DEFAULT_UPLOAD_FALLBACK_COST)
    )
  );
  const normalizedSize = Number(sizeBytes ?? 0);

  if (!Number.isFinite(normalizedSize) || normalizedSize <= 0) {
    return fallbackCost;
  }

  return Math.max(
    1,
    Math.min(maxCost, Math.ceil(normalizedSize / unitBytes))
  );
}
