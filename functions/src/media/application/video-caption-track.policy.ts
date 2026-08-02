import { HttpsError } from 'firebase-functions/v2/https';

export const MAX_VIDEO_CAPTION_SIZE_BYTES = 1024 * 1024;
export const VIDEO_CAPTION_MIME_TYPE = 'text/vtt';

export interface VideoCaptionTrackInput {
  captionStoragePath?: unknown;
  captionLanguage?: unknown;
  captionLabel?: unknown;
}

export interface NormalizedVideoCaptionMetadata {
  id: 'captions-1';
  kind: 'captions';
  language: string;
  label: string;
  isDefault: true;
}

function replaceControlCharacters(value: string): string {
  let sanitized = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    sanitized += code <= 31 || code === 127 ? ' ' : value[index];
  }

  return sanitized;
}

export function normalizeVideoCaptionLanguage(value: unknown): string {
  const raw = String(value ?? '').trim();

  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(raw)) {
    throw new HttpsError(
      'invalid-argument',
      'O idioma da legenda é inválido.'
    );
  }

  try {
    return Intl.getCanonicalLocales(raw)[0] ?? raw;
  } catch {
    throw new HttpsError(
      'invalid-argument',
      'O idioma da legenda é inválido.'
    );
  }
}

export function normalizeVideoCaptionLabel(value: unknown): string {
  const label = replaceControlCharacters(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

  if (!label) {
    throw new HttpsError(
      'invalid-argument',
      'Informe um rótulo para a legenda.'
    );
  }

  return label;
}

export function normalizeVideoCaptionMetadata(
  input: VideoCaptionTrackInput
): NormalizedVideoCaptionMetadata {
  return {
    id: 'captions-1',
    kind: 'captions',
    language: normalizeVideoCaptionLanguage(input.captionLanguage),
    label: normalizeVideoCaptionLabel(input.captionLabel),
    isDefault: true,
  };
}

export function assertValidWebVttContent(value: Buffer | string): void {
  const raw = Buffer.isBuffer(value)
    ? value.toString('utf8')
    : String(value ?? '');
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  if (normalized.includes('\u0000')) {
    throw new HttpsError(
      'failed-precondition',
      'A legenda contém caracteres inválidos.'
    );
  }

  if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized)) {
    throw new HttpsError(
      'failed-precondition',
      'O arquivo de legenda não possui um cabeçalho WebVTT válido.'
    );
  }

  if (!/\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d{2}:\d{2}(?::\d{2})?[.,]\d{3}/.test(normalized)) {
    throw new HttpsError(
      'failed-precondition',
      'A legenda precisa conter pelo menos um trecho com tempo válido.'
    );
  }
}
