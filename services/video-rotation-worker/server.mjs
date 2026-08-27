import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import http from 'node:http';

import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const PORT = Number(process.env.PORT ?? 8080);
const EXPECTED_BUCKET = String(process.env.VIDEO_STORAGE_BUCKET ?? '').trim();
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_SOURCE_BYTES = 500 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 750 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/x-msvideo',
  'video/x-ms-wmv',
  'video/mp2t',
  'application/mxf',
]);

class RequestValidationError extends Error {}

function cleanId(value) {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanProcessingVersion(value) {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,160}$/.test(normalized) ? normalized : '';
}

function normalizeRotation(value) {
  const rotation = Number(value);
  return rotation === 90 || rotation === 180 || rotation === 270
    ? rotation
    : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectedDestinationPath(ownerUid, videoId, processingVersion) {
  return (
    `users/${ownerUid}/processed/video-rotation-sources/${videoId}/` +
    `${processingVersion}/source.mp4`
  );
}

function validateSourcePath(ownerUid, videoId, value) {
  const path = String(value ?? '').trim();
  const expected = new RegExp(
    `^users/${escapeRegExp(ownerUid)}/uploads/videos/` +
      `${escapeRegExp(videoId)}-[^/]+\\.[A-Za-z0-9]{2,8}$`
  );

  return expected.test(path) ? path : '';
}

function safeExtension(storagePath) {
  const extension = extname(storagePath).toLowerCase();
  return /^\.[a-z0-9]{2,8}$/.test(extension) ? extension : '.input';
}

function filterForRotation(rotationDegrees) {
  if (rotationDegrees === 90) {
    return 'transpose=clock';
  }

  if (rotationDegrees === 180) {
    return 'hflip,vflip';
  }

  return 'transpose=cclock';
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readJson(request) {
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new RequestValidationError('Content-Type inválido.');
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new RequestValidationError('Requisição excede o limite permitido.');
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestValidationError('JSON inválido.');
  }
}

function runFfmpeg(inputPath, outputPath, rotationDegrees) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      filterForRotation(rotationDegrees),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '16',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      '-metadata:s:v:0',
      'rotate=0',
      '-y',
      outputPath,
    ];
    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-65_536);
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        `FFmpeg falhou (${signal ?? code ?? 'unknown'}): ` +
        `${stderr.trim().slice(-2_000) || 'sem detalhes'}`
      ));
    });
  });
}

async function destinationIsReady(bucket, storagePath) {
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    return false;
  }

  const [metadata] = await file.getMetadata();
  const sizeBytes = Number(metadata.size ?? 0);
  return Number.isFinite(sizeBytes) &&
    sizeBytes > 0 &&
    String(metadata.contentType ?? '').toLowerCase() === 'video/mp4';
}

async function rotateVideo(payload) {
  if (!EXPECTED_BUCKET) {
    throw new Error('VIDEO_STORAGE_BUCKET não configurado.');
  }

  const bucketName = String(payload?.bucketName ?? '').trim();
  const ownerUid = cleanId(payload?.ownerUid);
  const videoId = cleanId(payload?.videoId);
  const processingVersion = cleanProcessingVersion(payload?.processingVersion);
  const rotationDegrees = normalizeRotation(payload?.rotationDegrees);

  if (
    bucketName !== EXPECTED_BUCKET ||
    !ownerUid ||
    !videoId ||
    !processingVersion ||
    rotationDegrees === null
  ) {
    throw new RequestValidationError('Comando de rotação inválido.');
  }

  const sourceStoragePath = validateSourcePath(
    ownerUid,
    videoId,
    payload?.sourceStoragePath
  );
  const destinationStoragePath = String(
    payload?.destinationStoragePath ?? ''
  ).trim();
  const expectedDestination = expectedDestinationPath(
    ownerUid,
    videoId,
    processingVersion
  );

  if (!sourceStoragePath || destinationStoragePath !== expectedDestination) {
    throw new RequestValidationError('Caminho de mídia inválido.');
  }

  const bucket = storage.bucket(EXPECTED_BUCKET);

  if (await destinationIsReady(bucket, destinationStoragePath)) {
    return { destinationStoragePath, reused: true };
  }

  const sourceFile = bucket.file(sourceStoragePath);
  const [sourceExists] = await sourceFile.exists();
  if (!sourceExists) {
    throw new RequestValidationError('Arquivo de origem não encontrado.');
  }

  const [sourceMetadata] = await sourceFile.getMetadata();
  const sourceSizeBytes = Number(sourceMetadata.size ?? 0);
  const sourceContentType = String(sourceMetadata.contentType ?? '')
    .trim()
    .toLowerCase();

  if (
    !Number.isFinite(sourceSizeBytes) ||
    sourceSizeBytes <= 0 ||
    sourceSizeBytes > MAX_SOURCE_BYTES ||
    !ALLOWED_VIDEO_TYPES.has(sourceContentType)
  ) {
    throw new RequestValidationError('Arquivo de origem não suportado.');
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), 'video-rotation-'));
  const inputPath = join(
    workingDirectory,
    `source-${randomUUID()}${safeExtension(sourceStoragePath)}`
  );
  const outputPath = join(workingDirectory, `rotated-${randomUUID()}.mp4`);

  try {
    await sourceFile.download({ destination: inputPath });
    await runFfmpeg(inputPath, outputPath, rotationDegrees);

    const outputStats = await stat(outputPath);
    if (
      !outputStats.isFile() ||
      outputStats.size <= 0 ||
      outputStats.size > MAX_OUTPUT_BYTES
    ) {
      throw new Error('O arquivo rotacionado possui tamanho inválido.');
    }

    await bucket.upload(outputPath, {
      destination: destinationStoragePath,
      resumable: true,
      validation: 'crc32c',
      metadata: {
        contentType: 'video/mp4',
        contentDisposition: 'inline',
        cacheControl: 'private, max-age=0, no-store, no-transform',
        metadata: {
          source: 'video-rotation-worker',
          processingVersion,
          rotationDegrees: String(rotationDegrees),
        },
      },
    });

    if (!(await destinationIsReady(bucket, destinationStoragePath))) {
      throw new Error('Falha ao validar o resultado da rotação.');
    }

    return { destinationStoragePath, reused: false };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    sendJson(response, EXPECTED_BUCKET ? 200 : 503, {
      ok: !!EXPECTED_BUCKET,
    });
    return;
  }

  if (request.method !== 'POST' || request.url !== '/rotate') {
    sendJson(response, 404, { error: 'not-found' });
    return;
  }

  try {
    const payload = await readJson(request);
    const result = await rotateVideo(payload);
    sendJson(response, 200, result);
  } catch (error) {
    const clientError = error instanceof RequestValidationError;
    console.error('[video-rotation-worker] Falha.', {
      clientError,
      message: error instanceof Error
        ? error.message.slice(0, 2_000)
        : String(error ?? 'unknown').slice(0, 2_000),
    });
    sendJson(response, clientError ? 400 : 500, {
      error: clientError ? 'invalid-request' : 'processing-failed',
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[video-rotation-worker] listening on ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
