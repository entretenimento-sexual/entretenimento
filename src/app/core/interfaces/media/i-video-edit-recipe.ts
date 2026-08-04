export type TVideoEditAspectRatio =
  | 'ORIGINAL'
  | 'VERTICAL_9_16'
  | 'PORTRAIT_4_5'
  | 'SQUARE_1_1';

/**
 * Receita declarativa e não destrutiva aplicada pelo backend no Transcoder.
 * O arquivo original permanece privado e não é transformado no navegador.
 */
export interface IVideoEditRecipeInput {
  readonly version: 1;
  readonly trimStartMs: number;
  readonly trimEndMs: number | null;
  readonly aspectRatio: TVideoEditAspectRatio;
  readonly muteAudio: boolean;
  readonly orientation: 'AUTO';
  readonly sourceWidthPixels: number | null;
  readonly sourceHeightPixels: number | null;
}

export const DEFAULT_VIDEO_EDIT_RECIPE_INPUT: IVideoEditRecipeInput = {
  version: 1,
  trimStartMs: 0,
  trimEndMs: null,
  aspectRatio: 'ORIGINAL',
  muteAudio: false,
  orientation: 'AUTO',
  sourceWidthPixels: null,
  sourceHeightPixels: null,
};
