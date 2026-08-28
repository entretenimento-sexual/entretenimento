import { IMAGE_EDITOR_PRESETS } from '../media/media-format.generated';

export type PhotoEditorContext =
  | 'profile-photo'
  | 'profile-avatar'
  | 'community-feed'
  | 'social-feed'
  | 'community-cover'
  | 'generic';

export type PhotoEditorPreset = keyof typeof IMAGE_EDITOR_PRESETS;

export interface PhotoEditorProcessedResult {
  readonly kind: 'image';
  readonly file: File;
  readonly imageStateStr: string;
  readonly width: number;
  readonly height: number;
  readonly context: PhotoEditorContext;
  readonly preset: PhotoEditorPreset;
  readonly metadataStripped: true;
}

export interface PhotoEditorModalProcessSuccess {
  readonly reason: 'processSuccess';
  readonly result: PhotoEditorProcessedResult;
}
