/**
 * Cache efêmero de capas autorizadas da biblioteca privada.
 * Nunca persistir no NgRx, IndexedDB ou snapshots públicos.
 */
export interface PrivateVideoPreviewCacheEntry {
  readonly posterUrl: string | null;
  readonly posterPath: string | null;
  readonly expiresAt: number;
}

// Com renovação do rail ativo a cada 8min, exige margem para a próxima janela.
export const PRIVATE_VIDEO_PREVIEW_REFRESH_SAFETY_MS = 2 * 60 * 1000 + 30_000;
export const PRIVATE_VIDEO_PREVIEW_MAX_CACHE_ENTRIES = 128;

export function buildPrivateVideoPreviewCacheKey(input: {
  readonly sessionScope: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly revision: number | null | undefined;
  readonly status: string;
}): string {
  return JSON.stringify([
    input.sessionScope,
    input.ownerUid,
    input.videoId,
    input.revision ?? 0,
    input.status,
  ]);
}

function isHttpUrl(value: string | null): boolean {
  return value === null || /^https?:\/\//i.test(value.trim());
}

/**
 * A margem exige renovação antes de a URL expirar. O timer da biblioteca
 * segue ativo somente enquanto a UI é observada, e assina apenas posters.
 */
export class PrivateVideoPreviewCache {
  private readonly entries = new Map<string, PrivateVideoPreviewCacheEntry>();

  get(key: string, nowMs: number): PrivateVideoPreviewCacheEntry | null {
    const entry = this.entries.get(key);
    if (
      !entry ||
      !Number.isFinite(entry.expiresAt) ||
      !Number.isFinite(nowMs) ||
      entry.expiresAt <= nowMs + PRIVATE_VIDEO_PREVIEW_REFRESH_SAFETY_MS ||
      !isHttpUrl(entry.posterUrl)
    ) {
      this.entries.delete(key);
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, entry: PrivateVideoPreviewCacheEntry, nowMs: number): void {
    if (
      !key ||
      !Number.isFinite(entry.expiresAt) ||
      entry.expiresAt <= nowMs + PRIVATE_VIDEO_PREVIEW_REFRESH_SAFETY_MS ||
      !isHttpUrl(entry.posterUrl)
    ) {
      return;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);

    while (this.entries.size > PRIVATE_VIDEO_PREVIEW_MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
