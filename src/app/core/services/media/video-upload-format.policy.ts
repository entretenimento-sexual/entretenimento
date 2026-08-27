import {
  MEDIA_VIDEO_ACCEPT,
  MEDIA_VIDEO_FORMAT_LABEL,
  resolveVideoInputFormat,
} from './media-format.policy';

export interface VideoUploadFormat {
  extension: string;
  mimeType: string;
  browserPreviewLikely: boolean;
}

export const VIDEO_UPLOAD_ACCEPT = MEDIA_VIDEO_ACCEPT;
export const VIDEO_UPLOAD_FORMAT_LABEL = MEDIA_VIDEO_FORMAT_LABEL;

export function resolveVideoUploadFormat(
  candidate: Pick<File, 'name' | 'type'> | null | undefined
): VideoUploadFormat | null {
  return resolveVideoInputFormat(candidate);
}

export function isAcceptedVideoUploadFile(
  candidate: Pick<File, 'name' | 'type'> | null | undefined
): boolean {
  return resolveVideoUploadFormat(candidate) !== null;
}
