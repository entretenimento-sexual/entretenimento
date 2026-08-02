export type VideoPlaybackQuality = 'SD' | 'HD';

export interface VideoProcessingOutputFile {
  storagePath: string;
  contentType: string;
  sizeBytes: number;
}

export interface VideoProcessingVariant {
  quality: VideoPlaybackQuality;
  storagePath: string;
  mimeType: 'video/mp4';
  sizeBytes: number;
}

export interface VideoProcessingOutputInventory {
  variants: VideoProcessingVariant[];
  defaultQuality: VideoPlaybackQuality;
  hlsManifestStoragePath: string | null;
  dashManifestStoragePath: string | null;
}

export const VIDEO_PROCESSING_PIPELINE_VERSION = 'gcp-web-hd-v2';

function normalizeStoragePath(value: unknown): string {
  return String(value ?? '').trim().replace(/^\/+/, '');
}

function normalizeContentType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizePositiveInteger(value: unknown): number | null {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.trunc(numeric)
    : null;
}

function fileName(storagePath: string): string {
  const segments = storagePath.split('/');
  return segments.at(-1)?.trim().toLowerCase() ?? '';
}

function normalizeOutputFiles(
  files: readonly VideoProcessingOutputFile[]
): VideoProcessingOutputFile[] {
  return files.flatMap((file) => {
    const storagePath = normalizeStoragePath(file.storagePath);
    const contentType = normalizeContentType(file.contentType);
    const sizeBytes = normalizePositiveInteger(file.sizeBytes);

    return storagePath && sizeBytes
      ? [{ storagePath, contentType, sizeBytes }]
      : [];
  });
}

function asMp4Variant(
  file: VideoProcessingOutputFile,
  quality: VideoPlaybackQuality
): VideoProcessingVariant {
  return {
    quality,
    storagePath: file.storagePath,
    mimeType: 'video/mp4',
    sizeBytes: file.sizeBytes,
  };
}

function selectCanonicalMp4Variants(
  files: readonly VideoProcessingOutputFile[]
): VideoProcessingVariant[] {
  const mp4Files = files.filter((file) =>
    file.contentType === 'video/mp4' || fileName(file.storagePath).endsWith('.mp4')
  );
  const sd = mp4Files.find((file) => fileName(file.storagePath) === 'sd.mp4');
  const hd = mp4Files.find((file) => fileName(file.storagePath) === 'hd.mp4');
  const canonical = [
    ...(sd ? [asMp4Variant(sd, 'SD')] : []),
    ...(hd ? [asMp4Variant(hd, 'HD')] : []),
  ];

  if (canonical.length) {
    return canonical;
  }

  /**
   * Compatibilidade com jobs antigos ou templates personalizados: quando os
   * nomes canônicos não existem, o menor MP4 é tratado como SD e o maior como
   * HD. Um único MP4 permanece como HD para não reduzir qualidade sem evidência.
   */
  const sorted = [...mp4Files].sort(
    (left, right) => left.sizeBytes - right.sizeBytes
  );

  if (!sorted.length) {
    return [];
  }

  if (sorted.length === 1) {
    return [asMp4Variant(sorted[0], 'HD')];
  }

  return [
    asMp4Variant(sorted[0], 'SD'),
    asMp4Variant(sorted.at(-1)!, 'HD'),
  ];
}

function findManifest(
  files: readonly VideoProcessingOutputFile[],
  expectedFileName: string,
  expectedContentTypes: ReadonlySet<string>
): string | null {
  const candidate = files.find((file) =>
    fileName(file.storagePath) === expectedFileName &&
    (
      expectedContentTypes.has(file.contentType) ||
      !file.contentType
    )
  );

  return candidate?.storagePath ?? null;
}

export function inventoryVideoProcessingOutputs(
  files: readonly VideoProcessingOutputFile[]
): VideoProcessingOutputInventory {
  const normalizedFiles = normalizeOutputFiles(files);
  const variants = selectCanonicalMp4Variants(normalizedFiles);

  if (!variants.length) {
    throw new Error(
      'O Transcoder concluiu sem gerar uma variante MP4 compatível.'
    );
  }

  return {
    variants,
    defaultQuality: variants.some((variant) => variant.quality === 'HD')
      ? 'HD'
      : 'SD',
    hlsManifestStoragePath: findManifest(
      normalizedFiles,
      'manifest.m3u8',
      new Set([
        'application/vnd.apple.mpegurl',
        'application/x-mpegurl',
      ])
    ),
    dashManifestStoragePath: findManifest(
      normalizedFiles,
      'manifest.mpd',
      new Set(['application/dash+xml'])
    ),
  };
}

export function selectDefaultVideoProcessingVariant(
  inventory: VideoProcessingOutputInventory
): VideoProcessingVariant {
  const preferred = inventory.variants.find(
    (variant) => variant.quality === inventory.defaultQuality
  );

  if (preferred) {
    return preferred;
  }

  const fallback = inventory.variants[0];

  if (!fallback) {
    throw new Error('Nenhuma variante de vídeo foi inventariada.');
  }

  return fallback;
}
