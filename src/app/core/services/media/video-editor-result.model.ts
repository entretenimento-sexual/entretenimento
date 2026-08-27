import {
  DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
  IVideoEditRecipeInput,
} from 'src/app/core/interfaces/media/i-video-edit-recipe';

export type VideoEditorContext =
  | 'profile-video'
  | 'social-feed'
  | 'community-feed'
  | 'generic';

export interface IVideoEditorState {
  readonly recipe: IVideoEditRecipeInput;
  readonly valid: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}

export interface VideoEditorProcessedResult {
  readonly kind: 'video';
  readonly file: File;
  readonly recipe: IVideoEditRecipeInput;
  readonly posterBlob: Blob | null;
  readonly context: VideoEditorContext;
}

export const EMPTY_VIDEO_EDITOR_STATE: IVideoEditorState = {
  recipe: DEFAULT_VIDEO_EDIT_RECIPE_INPUT,
  valid: false,
  loading: false,
  error: null,
};
