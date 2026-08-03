export interface VideoUploadFormat {
  extension: string;
  mimeType: string;
  browserPreviewLikely: boolean;
}

/**
 * Contrato de entrada compatível com o pipeline atual de processamento.
 *
 * O cliente normaliza M4V para video/mp4 antes do envio. MOV permanece como
 * video/quicktime para ser transcodificado no backend. Formatos adicionais só
 * devem ser anunciados quando registro, fila e Transcoder os aceitarem juntos.
 */
const FORMAT_BY_EXTENSION: Readonly<Record<string, VideoUploadFormat>> = {
  mp4: {
    extension: 'mp4',
    mimeType: 'video/mp4',
    browserPreviewLikely: true,
  },
  m4v: {
    extension: 'm4v',
    mimeType: 'video/mp4',
    browserPreviewLikely: true,
  },
  mov: {
    extension: 'mov',
    mimeType: 'video/quicktime',
    browserPreviewLikely: false,
  },
  webm: {
    extension: 'webm',
    mimeType: 'video/webm',
    browserPreviewLikely: true,
  },
};

const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'video/x-m4v': 'm4v',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

export const VIDEO_UPLOAD_ACCEPT = [
  ...Object.keys(EXTENSION_BY_MIME_TYPE),
  ...Object.keys(FORMAT_BY_EXTENSION).map((extension) => `.${extension}`),
].join(',');

export const VIDEO_UPLOAD_FORMAT_LABEL = 'MP4, M4V, MOV ou WebM';

export function resolveVideoUploadFormat(
  candidate: Pick<File, 'name' | 'type'> | null | undefined
): VideoUploadFormat | null {
  if (!candidate) {
    return null;
  }

  const extension = fileExtension(candidate.name);
  const byExtension = extension ? FORMAT_BY_EXTENSION[extension] : undefined;
  const mimeType = String(candidate.type ?? '').trim().toLowerCase();
  const mimeExtension = EXTENSION_BY_MIME_TYPE[mimeType];
  const byMimeType = mimeExtension
    ? FORMAT_BY_EXTENSION[mimeExtension]
    : undefined;

  if (byExtension && byMimeType && byExtension.mimeType !== byMimeType.mimeType) {
    return null;
  }

  return byExtension ?? byMimeType ?? null;
}

export function isAcceptedVideoUploadFile(
  candidate: Pick<File, 'name' | 'type'> | null | undefined
): boolean {
  return resolveVideoUploadFormat(candidate) !== null;
}

function fileExtension(fileName: string): string {
  const normalized = String(fileName ?? '').trim().toLowerCase();
  const match = normalized.match(/\.([a-z0-9]{2,5})$/);

  return match?.[1] ?? '';
}
