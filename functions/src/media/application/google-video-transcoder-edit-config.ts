import {
  hasEffectiveVideoEdit,
  resolveVideoEditGeometry,
  type VideoEditRecipe,
} from './video-edit-recipe';

interface TranscoderInputConfig {
  key: string;
  uri: string;
  preprocessingConfig?: {
    crop: {
      topPixels: number;
      bottomPixels: number;
      leftPixels: number;
      rightPixels: number;
    };
  };
}

interface TranscoderEditAtom {
  key: string;
  inputs: string[];
  startTimeOffset: string;
  endTimeOffset?: string;
}

interface TranscoderElementaryStream {
  key: string;
  videoStream?: {
    h264: {
      widthPixels?: number;
      heightPixels?: number;
      frameRate: number;
      bitrateBps: number;
      pixelFormat: string;
      rateControlMode: string;
      crfLevel: number;
      gopDuration: string;
      profile: string;
      preset: string;
    };
  };
  audioStream?: {
    codec: string;
    bitrateBps: number;
    sampleRateHertz: number;
  };
}

export interface EditedTranscoderJobConfig {
  inputs: TranscoderInputConfig[];
  editList: TranscoderEditAtom[];
  elementaryStreams: TranscoderElementaryStream[];
  muxStreams: Array<{
    key: string;
    fileName: string;
    container: string;
    elementaryStreams: string[];
  }>;
  output: { uri: string };
}

function durationValue(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1000;
  return `${Number(seconds.toFixed(3))}s`;
}

function hasCrop(crop: {
  topPixels: number;
  bottomPixels: number;
  leftPixels: number;
  rightPixels: number;
}): boolean {
  return crop.topPixels > 0 ||
    crop.bottomPixels > 0 ||
    crop.leftPixels > 0 ||
    crop.rightPixels > 0;
}

export function buildEditedTranscoderJobConfig(input: {
  inputUri: string;
  outputUri: string;
  recipe: VideoEditRecipe;
  sourceDurationMs: number | null;
}): EditedTranscoderJobConfig | null {
  if (!hasEffectiveVideoEdit(input.recipe, input.sourceDurationMs)) {
    return null;
  }

  const geometry = resolveVideoEditGeometry(input.recipe);
  const crop = geometry?.crop;
  const videoInput: TranscoderInputConfig = {
    key: 'input0',
    uri: input.inputUri,
    ...(crop && hasCrop(crop)
      ? { preprocessingConfig: { crop } }
      : {}),
  };
  const editAtom: TranscoderEditAtom = {
    key: 'atom0',
    inputs: ['input0'],
    startTimeOffset: durationValue(input.recipe.trimStartMs),
    ...(input.recipe.trimEndMs !== null
      ? { endTimeOffset: durationValue(input.recipe.trimEndMs) }
      : {}),
  };
  const videoStream: TranscoderElementaryStream = {
    key: 'video-stream0',
    videoStream: {
      h264: {
        ...(geometry
          ? {
            widthPixels: geometry.outputWidthPixels,
            heightPixels: geometry.outputHeightPixels,
          }
          : { widthPixels: 1280 }),
        frameRate: 30,
        bitrateBps: 2_500_000,
        pixelFormat: 'yuv420p',
        rateControlMode: 'vbr',
        crfLevel: 21,
        gopDuration: '3s',
        profile: 'high',
        preset: 'veryfast',
      },
    },
  };
  const audioStream: TranscoderElementaryStream = {
    key: 'audio-stream0',
    audioStream: {
      codec: 'aac',
      bitrateBps: 128_000,
      sampleRateHertz: 48_000,
    },
  };
  const elementaryStreams = input.recipe.muteAudio
    ? [videoStream]
    : [videoStream, audioStream];

  return {
    inputs: [videoInput],
    editList: [editAtom],
    elementaryStreams,
    muxStreams: [
      {
        key: 'playback',
        fileName: 'playback.mp4',
        container: 'mp4',
        elementaryStreams: elementaryStreams.map((stream) => stream.key),
      },
    ],
    output: { uri: input.outputUri },
  };
}
