export type TVideoEditAspectRatio =
  | 'ORIGINAL'
  | 'VERTICAL_9_16'
  | 'PORTRAIT_4_5'
  | 'SQUARE_1_1';

export type TVideoRotationDegrees = 0 | 90 | 180 | 270;

/**
 * Receita declarativa e não destrutiva aplicada pelo backend.
 * O arquivo original permanece privado e não é transformado no navegador.
 */
export interface IVideoEditRecipeInput {
  readonly version: 1;
  readonly trimStartMs: number;
  readonly trimEndMs: number | null;
  readonly aspectRatio: TVideoEditAspectRatio;
  readonly rotationDegrees: TVideoRotationDegrees;
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
  rotationDegrees: 0,
  muteAudio: false,
  orientation: 'AUTO',
  sourceWidthPixels: null,
  sourceHeightPixels: null,
};
