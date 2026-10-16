import { spawn } from 'node:child_process';

const MAX_PROBE_OUTPUT_BYTES = 128 * 1024;
const PROBE_TIMEOUT_MS = 45_000;
const MAX_VIDEO_DIMENSION = 16_384;
const MIN_VIDEO_DURATION_SECONDS = 5;
const MAX_VIDEO_DURATION_SECONDS = 24 * 60 * 60;

export class VideoProbeError extends Error {
  constructor(code, statusCode = 422) {
    super(code);
    this.name = 'VideoProbeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function positiveDimension(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 2 || n > MAX_VIDEO_DIMENSION) {
    throw new VideoProbeError('VIDEO_PROBE_INVALID_DIMENSIONS');
  }
  return n;
}

function durationSeconds(...candidates) {
  const selected = candidates
    .map(value => Number(value))
    .find(value => Number.isFinite(value) && value > 0);
  if (selected === undefined ||
      selected < MIN_VIDEO_DURATION_SECONDS ||
      selected > MAX_VIDEO_DURATION_SECONDS) {
    throw new VideoProbeError('VIDEO_PROBE_INVALID_DURATION');
  }
  return selected;
}

function safeCodec(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(value)
    ? value.toLowerCase() : 'unknown';
}

function sar(value) {
  if (typeof value !== 'string' || value === 'N/A') {
    return { numerator: 1, denominator: 1 };
  }
  const match = /^(\d{1,6}):(\d{1,6})$/.exec(value);
  if (!match) throw new VideoProbeError('VIDEO_PROBE_INVALID_DIMENSIONS');
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!numerator || !denominator || numerator / denominator > 100 ||
      denominator / numerator > 100) {
    throw new VideoProbeError('VIDEO_PROBE_INVALID_DIMENSIONS');
  }
  return { numerator, denominator };
}

function rotationDegrees(video) {
  const values = [
    ...(Array.isArray(video.side_data_list)
      ? video.side_data_list.map(item => item?.rotation) : []),
    video.tags?.rotate,
  ];
  const rotation = values.find(v => v !== undefined && v !== null && String(v).trim());
  if (rotation === undefined) return 0;
  const number = Number(rotation);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number % 90 !== 0) {
    throw new VideoProbeError('VIDEO_PROBE_UNSUPPORTED_ROTATION');
  }
  return ((number % 360) + 360) % 360;
}

/** Fields come exclusively from ffprobe applied to the downloaded object bytes. */
export function normalizeVideoProbeJson(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.streams)) {
    throw new VideoProbeError('VIDEO_PROBE_INVALID_MEDIA');
  }
  const video = raw.streams.find(stream => stream?.codec_type === 'video' &&
    stream.disposition?.attached_pic !== 1);
  if (!video) throw new VideoProbeError('VIDEO_PROBE_NO_VIDEO_STREAM');

  const widthPixels = positiveDimension(video.width);
  const heightPixels = positiveDimension(video.height);
  const durationMs = Math.round(durationSeconds(raw.format?.duration, video.duration) * 1_000);
  const audio = raw.streams.find(stream => stream?.codec_type === 'audio');
  const sampleAspectRatio = sar(video.sample_aspect_ratio);
  const embeddedRotationDegrees = rotationDegrees(video);
  return Object.freeze({
    widthPixels,
    heightPixels,
    displayAspectNumerator: widthPixels * sampleAspectRatio.numerator,
    displayAspectDenominator: heightPixels * sampleAspectRatio.denominator,
    sampleAspectRatio,
    embeddedRotationDegrees,
    durationMs,
    videoCodec: safeCodec(video.codec_name),
    hasAudio: Boolean(audio),
    audioCodec: audio ? safeCodec(audio.codec_name) : null,
  });
}

/** Never interpolates user input into a shell or command-line option. */
export function runVideoProbe(inputFilePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error', '-show_format', '-show_streams',
      '-of', 'json', '--', inputFilePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(data);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new VideoProbeError('VIDEO_PROBE_TIMEOUT', 504));
    }, PROBE_TIMEOUT_MS);
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_PROBE_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new VideoProbeError('VIDEO_PROBE_INVALID_MEDIA'));
        return;
      }
      stdout += chunk.toString('utf8');
    });
    // Do not reflect ffprobe stderr, which may contain input paths.
    child.stderr.resume();
    child.on('error', () => finish(new VideoProbeError('VIDEO_PROBE_UNAVAILABLE', 503)));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) {
        finish(new VideoProbeError('VIDEO_PROBE_INVALID_MEDIA'));
        return;
      }
      try {
        finish(null, normalizeVideoProbeJson(JSON.parse(stdout)));
      } catch (error) {
        finish(error instanceof VideoProbeError ? error :
          new VideoProbeError('VIDEO_PROBE_INVALID_MEDIA'));
      }
    });
  });
}
