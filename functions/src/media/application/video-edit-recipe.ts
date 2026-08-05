export type VideoEditAspectRatio =
  | 'ORIGINAL'
  | 'VERTICAL_9_16'
  | 'PORTRAIT_4_5'
  | 'SQUARE_1_1';

export interface VideoEditRecipe {
  readonly version: 1;
  readonly trimStartMs: number;
  readonly trimEndMs: number | null;
  readonly aspectRatio: VideoEditAspectRatio;
  readonly muteAudio: boolean;
  readonly orientation: 'AUTO';
  readonly sourceWidthPixels: number | null;
  readonly sourceHeightPixels: number | null;
}

export interface VideoEditCrop {
  readonly topPixels: number;
  readonly bottomPixels: number;
  readonly leftPixels: number;
  readonly rightPixels: number;
}

export interface VideoEditGeometry {
  readonly crop: VideoEditCrop;
  readonly outputWidthPixels: number;
  readonly outputHeightPixels: number;
}

export class VideoEditRecipeValidationError extends Error {
  readonly code = 'INVALID_VIDEO_EDIT_RECIPE';

  constructor(message: string) {
    super(message);
    this.name = 'VideoEditRecipeValidationError';
  }
}

export const MIN_EDITED_VIDEO_DURATION_MS = 5_000;
const MAX_SOURCE_DIMENSION_PIXELS = 16_384;

function finiteInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : null;
}

function optionalPositiveDimension(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = finiteInteger(value);
  if (
    normalized === null ||
    normalized < 2 ||
    normalized > MAX_SOURCE_DIMENSION_PIXELS
  ) {
    throw new VideoEditRecipeValidationError(
      'As dimensões informadas para o vídeo são inválidas.'
    );
  }

  return normalized;
}

function normalizeAspectRatio(value: unknown): VideoEditAspectRatio {
  const normalized = String(value ?? '').trim().toUpperCase();

  if (
    normalized === 'VERTICAL_9_16' ||
    normalized === 'PORTRAIT_4_5' ||
    normalized === 'SQUARE_1_1'
  ) {
    return normalized;
  }

  return 'ORIGINAL';
}

function normalizeSourceDuration(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = finiteInteger(value);
  if (
    normalized === null ||
    normalized < MIN_EDITED_VIDEO_DURATION_MS
  ) {
    throw new VideoEditRecipeValidationError(
      'A duração do vídeo não permite aplicar esta edição.'
    );
  }

  return normalized;
}

export function normalizeVideoEditRecipe(
  input: unknown,
  sourceDurationValue: unknown
): VideoEditRecipe {
  const raw = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : {};
  const sourceDurationMs = normalizeSourceDuration(sourceDurationValue);
  const aspectRatio = normalizeAspectRatio(raw['aspectRatio']);
  const sourceWidthPixels = optionalPositiveDimension(
    raw['sourceWidthPixels']
  );
  const sourceHeightPixels = optionalPositiveDimension(
    raw['sourceHeightPixels']
  );
  const requestedStart = finiteInteger(raw['trimStartMs']) ?? 0;
  const rawEnd = raw['trimEndMs'];
  const requestedEnd = rawEnd === null || rawEnd === undefined || rawEnd === ''
    ? null
    : finiteInteger(rawEnd);

  if (requestedStart < 0) {
    throw new VideoEditRecipeValidationError(
      'O início do corte não pode ser negativo.'
    );
  }

  if (requestedEnd !== null && requestedEnd <= requestedStart) {
    throw new VideoEditRecipeValidationError(
      'O fim do corte precisa ser posterior ao início.'
    );
  }

  if (
    sourceDurationMs === null &&
    (requestedStart > 0 || requestedEnd !== null)
  ) {
    throw new VideoEditRecipeValidationError(
      'A duração precisa ser conhecida para cortar o vídeo.'
    );
  }

  if (sourceDurationMs !== null) {
    if (requestedStart >= sourceDurationMs) {
      throw new VideoEditRecipeValidationError(
        'O início do corte ultrapassa a duração do vídeo.'
      );
    }

    if (requestedEnd !== null && requestedEnd > sourceDurationMs) {
      throw new VideoEditRecipeValidationError(
        'O fim do corte ultrapassa a duração do vídeo.'
      );
    }

    const effectiveEnd = requestedEnd ?? sourceDurationMs;
    if (effectiveEnd - requestedStart < MIN_EDITED_VIDEO_DURATION_MS) {
      throw new VideoEditRecipeValidationError(
        'O vídeo editado precisa ter pelo menos 5 segundos.'
      );
    }
  }

  if (
    aspectRatio !== 'ORIGINAL' &&
    (!sourceWidthPixels || !sourceHeightPixels)
  ) {
    throw new VideoEditRecipeValidationError(
      'As dimensões do vídeo são necessárias para alterar o enquadramento.'
    );
  }

  return {
    version: 1,
    trimStartMs: requestedStart,
    trimEndMs: requestedEnd,
    aspectRatio,
    muteAudio: raw['muteAudio'] === true,
    orientation: 'AUTO',
    sourceWidthPixels,
    sourceHeightPixels,
  };
}

export function hasEffectiveVideoEdit(
  recipe: VideoEditRecipe,
  sourceDurationValue: unknown
): boolean {
  const sourceDurationMs = normalizeSourceDuration(sourceDurationValue);
  const trimsEnd =
    recipe.trimEndMs !== null &&
    (sourceDurationMs === null || recipe.trimEndMs < sourceDurationMs);

  return recipe.trimStartMs > 0 ||
    trimsEnd ||
    recipe.aspectRatio !== 'ORIGINAL' ||
    recipe.muteAudio;
}

export function resolveEditedVideoDurationMs(
  recipe: VideoEditRecipe,
  sourceDurationValue: unknown
): number | null {
  const sourceDurationMs = normalizeSourceDuration(sourceDurationValue);
  if (sourceDurationMs === null) {
    return null;
  }

  return (recipe.trimEndMs ?? sourceDurationMs) - recipe.trimStartMs;
}

function targetRatio(aspectRatio: VideoEditAspectRatio): number | null {
  switch (aspectRatio) {
  case 'VERTICAL_9_16':
    return 9 / 16;
  case 'PORTRAIT_4_5':
    return 4 / 5;
  case 'SQUARE_1_1':
    return 1;
  default:
    return null;
  }
}

function evenFloor(value: number): number {
  const integer = Math.max(2, Math.floor(value));
  return integer % 2 === 0 ? integer : integer - 1;
}

function centeredCrop(
  width: number,
  height: number,
  ratio: number | null
): VideoEditCrop {
  if (!ratio) {
    return {
      topPixels: 0,
      bottomPixels: 0,
      leftPixels: 0,
      rightPixels: 0,
    };
  }

  const sourceRatio = width / height;
  if (Math.abs(sourceRatio - ratio) < 0.001) {
    return {
      topPixels: 0,
      bottomPixels: 0,
      leftPixels: 0,
      rightPixels: 0,
    };
  }

  if (sourceRatio > ratio) {
    const retainedWidth = evenFloor(height * ratio);
    const removed = Math.max(0, width - retainedWidth);
    const leftPixels = Math.floor(removed / 2);

    return {
      topPixels: 0,
      bottomPixels: 0,
      leftPixels,
      rightPixels: removed - leftPixels,
    };
  }

  const retainedHeight = evenFloor(width / ratio);
  const removed = Math.max(0, height - retainedHeight);
  const topPixels = Math.floor(removed / 2);

  return {
    topPixels,
    bottomPixels: removed - topPixels,
    leftPixels: 0,
    rightPixels: 0,
  };
}

export function resolveVideoEditGeometry(
  recipe: VideoEditRecipe
): VideoEditGeometry | null {
  const width = recipe.sourceWidthPixels;
  const height = recipe.sourceHeightPixels;

  if (!width || !height) {
    return null;
  }

  const crop = centeredCrop(width, height, targetRatio(recipe.aspectRatio));
  const croppedWidth = evenFloor(
    width - crop.leftPixels - crop.rightPixels
  );
  const croppedHeight = evenFloor(
    height - crop.topPixels - crop.bottomPixels
  );
  const isLandscape = croppedWidth >= croppedHeight;
  const maxWidth = isLandscape ? 1280 : 720;
  const maxHeight = isLandscape ? 720 : 1280;
  const scale = Math.min(
    1,
    maxWidth / croppedWidth,
    maxHeight / croppedHeight
  );

  return {
    crop,
    outputWidthPixels: evenFloor(croppedWidth * scale),
    outputHeightPixels: evenFloor(croppedHeight * scale),
  };
}

export const DEFAULT_VIDEO_EDIT_RECIPE: VideoEditRecipe = {
  version: 1,
  trimStartMs: 0,
  trimEndMs: null,
  aspectRatio: 'ORIGINAL',
  muteAudio: false,
  orientation: 'AUTO',
  sourceWidthPixels: null,
  sourceHeightPixels: null,
};
