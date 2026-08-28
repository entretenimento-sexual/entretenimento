interface PublicMediaAssetVersionInput {
  readonly assetVersion?: unknown;
  readonly publishedAt?: unknown;
}

function toMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) && millis > 0 ? Math.floor(millis) : 0;
  }

  const timestamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: number;
  } | null | undefined;

  if (typeof timestamp?.toMillis === 'function') {
    try {
      return toMillis(timestamp.toMillis());
    } catch {
      return 0;
    }
  }

  if (typeof timestamp?.toDate === 'function') {
    try {
      return toMillis(timestamp.toDate());
    } catch {
      return 0;
    }
  }

  if (typeof timestamp?.seconds === 'number') {
    return toMillis(timestamp.seconds * 1_000);
  }

  return 0;
}

/**
 * Resolve exclusivamente a versão do arquivo público.
 *
 * `updatedAt` não participa da identidade do cache: views, reações, comentários,
 * moderação e ranking podem atualizá-lo sem substituir o binário. Documentos
 * legados sem `assetVersion` usam `publishedAt` como fallback estável.
 */
export function resolvePublicMediaAssetVersion(
  input: PublicMediaAssetVersionInput
): number {
  return toMillis(input.assetVersion) || toMillis(input.publishedAt);
}

export function buildPublicMediaAccessCacheKey(input: {
  readonly namespace: 'public-photo-access' | 'public-video-access';
  readonly ownerUid: string;
  readonly mediaId: string;
  readonly assetVersion?: unknown;
  readonly publishedAt?: unknown;
}): string {
  const version = resolvePublicMediaAssetVersion(input);

  return [
    input.namespace,
    input.ownerUid.trim(),
    input.mediaId.trim(),
    String(version),
  ].join(':');
}
