import {
  AVATAR_IMAGE_MAX_BYTES,
  IMAGE_EDITOR_PRESETS,
  IMAGE_FORMAT_LABEL,
  IMAGE_INPUT_ACCEPT,
  IMAGE_INPUT_FORMATS,
  IMAGE_INPUT_MIME_TYPES,
  IMAGE_MAX_BYTES,
  VIDEO_FORMAT_LABEL,
  VIDEO_INPUT_ACCEPT,
  VIDEO_INPUT_FORMATS,
  VIDEO_MAX_BYTES,
  VIDEO_POSTER_IMAGE_MAX_BYTES,
} from './media-format.generated';

export type ImageMediaContext = 'default' | 'avatar' | 'video-poster';
export type ImageEditorPresetKey = keyof typeof IMAGE_EDITOR_PRESETS;

export interface MediaFileValidationResult {
  readonly valid: boolean;
  readonly userMessage?: string;
}

export interface ResolvedMediaFormat {
  readonly extension: string;
  readonly mimeType: string;
  readonly browserPreviewLikely: boolean;
}

type ImageFileCandidate = Pick<File, 'type' | 'size'> &
  Partial<Pick<File, 'name'>>;
type GeneratedImageInputFormat = (typeof IMAGE_INPUT_FORMATS)[number];
type GeneratedVideoInputFormat = (typeof VIDEO_INPUT_FORMATS)[number];

const IMAGE_MIME_TYPES = new Set<string>(IMAGE_INPUT_MIME_TYPES);
const IMAGE_EXTENSION_MAP = new Map<string, GeneratedImageInputFormat>(
  IMAGE_INPUT_FORMATS.map(
    (format): [string, GeneratedImageInputFormat] => [format.extension, format]
  )
);
const IMAGE_MIME_MAP = new Map<string, GeneratedImageInputFormat>();
for (const format of IMAGE_INPUT_FORMATS) {
  for (const mimeType of format.mimeTypes) {
    if (!IMAGE_MIME_MAP.has(mimeType)) {
      IMAGE_MIME_MAP.set(mimeType, format);
    }
  }
}

const VIDEO_EXTENSION_MAP = new Map<string, GeneratedVideoInputFormat>(
  VIDEO_INPUT_FORMATS.map(
    (format): [string, GeneratedVideoInputFormat] => [format.extension, format]
  )
);
const VIDEO_MIME_MAP = new Map<string, GeneratedVideoInputFormat>();
for (const format of VIDEO_INPUT_FORMATS) {
  for (const mimeType of format.mimeTypes) {
    if (!VIDEO_MIME_MAP.has(mimeType)) {
      VIDEO_MIME_MAP.set(mimeType, format);
    }
  }
}

export const MEDIA_IMAGE_ACCEPT = IMAGE_INPUT_ACCEPT;
export const MEDIA_VIDEO_ACCEPT = VIDEO_INPUT_ACCEPT;
export const MEDIA_IMAGE_FORMAT_LABEL = IMAGE_FORMAT_LABEL;
export const MEDIA_VIDEO_FORMAT_LABEL = VIDEO_FORMAT_LABEL;
export const MEDIA_IMAGE_EDITOR_PRESETS = IMAGE_EDITOR_PRESETS;
export const MEDIA_VIDEO_MAX_BYTES = VIDEO_MAX_BYTES;
export const MEDIA_VIDEO_POSTER_MAX_BYTES = VIDEO_POSTER_IMAGE_MAX_BYTES;

export function resolveImageMaxBytes(context: ImageMediaContext = 'default'): number {
  switch (context) {
    case 'avatar':
      return AVATAR_IMAGE_MAX_BYTES;
    case 'video-poster':
      return VIDEO_POSTER_IMAGE_MAX_BYTES;
    default:
      return IMAGE_MAX_BYTES;
  }
}

export function isAcceptedImageMimeType(value: unknown): boolean {
  return IMAGE_MIME_TYPES.has(String(value ?? '').trim().toLowerCase());
}

export function resolveImageInputFormat(
  candidate: (Pick<File, 'type'> & Partial<Pick<File, 'name'>>) | null | undefined
): ResolvedMediaFormat | null {
  if (!candidate) {
    return null;
  }

  const extension = fileExtension(candidate.name ?? '');
  const mimeType = String(candidate.type ?? '').trim().toLowerCase();
  const byExtension = extension ? IMAGE_EXTENSION_MAP.get(extension) : undefined;
  const byMimeType = mimeType ? IMAGE_MIME_MAP.get(mimeType) : undefined;

  if (extension && !byExtension) {
    return null;
  }

  if (mimeType && !byMimeType) {
    return null;
  }

  if (byExtension && byMimeType) {
    const extensionMimeTypes = new Set<string>(byExtension.mimeTypes);
    if (!extensionMimeTypes.has(mimeType)) {
      return null;
    }
  }

  const resolved = byExtension ?? byMimeType;
  if (!resolved) {
    return null;
  }

  return {
    extension: resolved.extension,
    mimeType: resolved.mimeTypes[0],
    browserPreviewLikely: resolved.browserPreviewLikely,
  };
}

export function validateImageMediaFile(
  file: ImageFileCandidate | null | undefined,
  context: ImageMediaContext = 'default'
): MediaFileValidationResult {
  if (!file) {
    return { valid: false, userMessage: 'Selecione uma imagem válida.' };
  }

  if (!resolveImageInputFormat(file)) {
    return {
      valid: false,
      userMessage: `Formato inválido. Use ${IMAGE_FORMAT_LABEL}.`,
    };
  }

  const maxBytes = resolveImageMaxBytes(context);
  const size = Number(file.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    return { valid: false, userMessage: 'A imagem selecionada está vazia.' };
  }

  if (size > maxBytes) {
    return {
      valid: false,
      userMessage: `A imagem deve ter no máximo ${formatMegabytes(maxBytes)} MB.`,
    };
  }

  return { valid: true };
}

export function resolveImageEditorPreset(key: ImageEditorPresetKey) {
  return IMAGE_EDITOR_PRESETS[key];
}

export function resolveVideoInputFormat(
  candidate: Pick<File, 'name' | 'type'> | null | undefined
): ResolvedMediaFormat | null {
  if (!candidate) {
    return null;
  }

  const extension = fileExtension(candidate.name);
  const mimeType = String(candidate.type ?? '').trim().toLowerCase();
  const byExtension = extension ? VIDEO_EXTENSION_MAP.get(extension) : undefined;
  const byMimeType = mimeType ? VIDEO_MIME_MAP.get(mimeType) : undefined;

  if (extension && !byExtension) {
    return null;
  }

  if (mimeType && !byMimeType) {
    return null;
  }

  if (byExtension && byMimeType) {
    const extensionCanonicalMime =
      byExtension.canonicalMimeType ?? byExtension.mimeTypes[0];
    const mimeCanonicalMime =
      byMimeType.canonicalMimeType ?? byMimeType.mimeTypes[0];

    if (extensionCanonicalMime !== mimeCanonicalMime) {
      return null;
    }
  }

  const resolved = byExtension ?? byMimeType;
  if (!resolved) {
    return null;
  }

  return {
    extension: resolved.extension,
    mimeType: resolved.canonicalMimeType ?? resolved.mimeTypes[0],
    browserPreviewLikely: resolved.browserPreviewLikely,
  };
}

export function validateVideoMediaFile(
  file: Pick<File, 'name' | 'type' | 'size'> | null | undefined
): MediaFileValidationResult {
  if (!file) {
    return { valid: false, userMessage: 'Selecione um vídeo válido.' };
  }

  if (!resolveVideoInputFormat(file)) {
    return {
      valid: false,
      userMessage: `Formato inválido. Use ${VIDEO_FORMAT_LABEL}.`,
    };
  }

  const size = Number(file.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    return { valid: false, userMessage: 'O vídeo selecionado está vazio.' };
  }

  if (size > VIDEO_MAX_BYTES) {
    return {
      valid: false,
      userMessage: `O vídeo deve ter no máximo ${formatMegabytes(VIDEO_MAX_BYTES)} MB.`,
    };
  }

  return { valid: true };
}

export function resolveImageExtensionFromMimeType(value: unknown): string | null {
  const mimeType = String(value ?? '').trim().toLowerCase();
  return IMAGE_MIME_MAP.get(mimeType)?.extension ?? null;
}

function formatMegabytes(bytes: number): string {
  return Number((bytes / (1024 * 1024)).toFixed(1)).toString();
}

function fileExtension(fileName: string): string {
  const normalized = String(fileName ?? '').trim().toLowerCase();
  const match = normalized.match(/\.([a-z0-9]{2,5})$/);
  return match?.[1] ?? '';
}
