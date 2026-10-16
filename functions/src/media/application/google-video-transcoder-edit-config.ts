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

interface SingleMp4TranscoderInput {
  inputUri: string;
  outputUri: string;
  recipe: VideoEditRecipe;
  sourceDurationMs: number | null;
}

export function buildEditedTranscoderJobConfig(
  input: SingleMp4TranscoderInput
): EditedTranscoderJobConfig | null {
  if (!hasEffectiveVideoEdit(input.recipe, input.sourceDurationMs)) {
    return null;
  }
  return buildSingleMp4TranscoderJobConfig(input);
}

/**
 * One MP4 only when the persisted geometry is present. Missing dimensions
 * retain the existing template until their provenance can be verified.
 * We still transcode: this is NOT a direct-upload playback bypass.
 */
export function buildNeutralSingleMp4Config(
  input: SingleMp4TranscoderInput
): EditedTranscoderJobConfig | null {
  const geometry = resolveVideoEditGeometry(input.recipe);
  if (hasEffectiveVideoEdit(input.recipe, input.sourceDurationMs) || !geometry) {
    return null;
  }
  const config = buildSingleMp4TranscoderJobConfig(input);
  const h264 = config.elementaryStreams[0]?.videoStream?.h264;
  if (!h264) return null;

  // The dimensions in the persisted edit recipe originate from the client,
  // not from an authoritative media probe. Use them only to choose a target
  // long-side bound. Asking the Transcoder for just one dimension delegates
  // the other to the real input aspect ratio, preventing stretched outputs.
  // No-upscale is not authoritative until the source dimensions are probed.
  if (geometry.outputWidthPixels >= geometry.outputHeightPixels) {
    delete h264.widthPixels;
  } else {
    delete h264.heightPixels;
  }
  return config;
}

function buildSingleMp4TranscoderJobConfig(
  input: SingleMp4TranscoderInput
): EditedTranscoderJobConfig {
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
