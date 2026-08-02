export type VideoPlaybackQuality = 'SD' | 'HD';
export type VideoPlaybackMimeType = 'video/mp4' | 'video/webm';

export interface VideoProcessingOutputFile {
  storagePath: string;
  contentType: string;
  sizeBytes: number;
}

export interface VideoProcessingVariant {
  quality: VideoPlaybackQuality;
  storagePath: string;
  mimeType: VideoPlaybackMimeType;
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

function asVariant(
  file: VideoProcessingOutputFile,
  quality: VideoPlaybackQuality,
  mimeType: VideoPlaybackMimeType
): VideoProcessingVariant {
  return {
    quality,
    storagePath: file.storagePath,
    mimeType,
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
    ...(sd ? [asVariant(sd, 'SD', 'video/mp4')] : []),
    ...(hd ? [asVariant(hd, 'HD', 'video/mp4')] : []),
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
    return [asVariant(sorted[0], 'HD', 'video/mp4')];
  }

  return [
    asVariant(sorted[0], 'SD', 'video/mp4'),
    asVariant(sorted.at(-1)!, 'HD', 'video/mp4'),
  ];
}

function selectLegacyWebmVariant(
  files: readonly VideoProcessingOutputFile[]
): VideoProcessingVariant[] {
  const webmFiles = files
    .filter((file) =>
      file.contentType === 'video/webm' ||
      fileName(file.storagePath).endsWith('.webm')
    )
    .sort((left, right) => right.sizeBytes - left.sizeBytes);
  const candidate = webmFiles[0];

  return candidate
    ? [asVariant(candidate, 'HD', 'video/webm')]
    : [];
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
  const compatibleVariants = variants.length
    ? variants
    : selectLegacyWebmVariant(normalizedFiles);

  if (!compatibleVariants.length) {
    throw new Error(
      'O processamento concluiu sem gerar uma variante reproduzível.'
    );
  }

  return {
    variants: compatibleVariants,
    defaultQuality: compatibleVariants.some(
      (variant) => variant.quality === 'HD'
    )
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
