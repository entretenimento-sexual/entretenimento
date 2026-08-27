import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const manifestPath = path.join(repoRoot, 'config', 'media-formats.json');
const checkOnly = process.argv.includes('--check');

const frontendTarget = path.join(
  repoRoot,
  'src',
  'app',
  'core',
  'services',
  'media',
  'media-format.generated.ts'
);
const functionsTarget = path.join(
  repoRoot,
  'functions',
  'src',
  'media',
  'media-format.generated.ts'
);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function assertNonEmptyArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} precisa ser uma lista não vazia.`);
  }
}

function normalizeMime(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized)) {
    throw new Error(`MIME inválido no manifesto: ${value}`);
  }
  return normalized;
}

function normalizeExtension(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9]{2,5}$/.test(normalized)) {
    throw new Error(`Extensão inválida no manifesto: ${value}`);
  }
  return normalized;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} precisa ser inteiro positivo.`);
  }
  return normalized;
}

function normalizeLossyQuality(value, label) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 1) {
    throw new Error(`${label} precisa estar entre 0 (exclusivo) e 1.`);
  }
  return Number(normalized.toFixed(2));
}

function normalizeAspectRatio(value, label) {
  const normalized = String(value ?? '').trim();
  if (!['original', 'square', 'portrait', 'landscape'].includes(normalized)) {
    throw new Error(`${label} possui proporção inválida: ${value}`);
  }
  return normalized;
}

function normalizeLineEndings(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function unique(values) {
  return [...new Set(values)];
}

assertNonEmptyArray(manifest?.image?.inputFormats, 'image.inputFormats');
assertNonEmptyArray(manifest?.image?.outputMimeTypes, 'image.outputMimeTypes');
assertNonEmptyArray(manifest?.video?.inputFormats, 'video.inputFormats');
assertNonEmptyArray(manifest?.video?.publicPlaybackMimeTypes, 'video.publicPlaybackMimeTypes');

const rawEditorPresets = manifest?.image?.editorPresets;
if (!rawEditorPresets || typeof rawEditorPresets !== 'object' || Array.isArray(rawEditorPresets)) {
  throw new Error('image.editorPresets precisa ser um objeto.');
}

const imageFormats = manifest.image.inputFormats.map((format) => ({
  extension: normalizeExtension(format.extension),
  mimeTypes: unique(format.mimeTypes.map(normalizeMime)),
  browserPreviewLikely: format.browserPreviewLikely === true,
  editable: format.editable === true,
  preservesTransparency: format.preservesTransparency === true,
}));

const videoFormats = manifest.video.inputFormats.map((format) => ({
  extension: normalizeExtension(format.extension),
  mimeTypes: unique(format.mimeTypes.map(normalizeMime)),
  canonicalMimeType: format.canonicalMimeType
    ? normalizeMime(format.canonicalMimeType)
    : null,
  browserPreviewLikely: format.browserPreviewLikely === true,
}));

const imageEditorPresets = Object.fromEntries(
  Object.entries(rawEditorPresets).map(([key, preset]) => {
    const safeKey = String(key ?? '').trim();
    if (!/^[a-z0-9-]{2,40}$/.test(safeKey)) {
      throw new Error(`Preset de editor inválido: ${key}`);
    }

    return [safeKey, {
      aspectRatio: normalizeAspectRatio(
        preset?.aspectRatio,
        `image.editorPresets.${safeKey}.aspectRatio`
      ),
      lockAspectRatio: preset?.lockAspectRatio === true,
      maxOutputEdge: normalizePositiveInteger(
        preset?.maxOutputEdge,
        `image.editorPresets.${safeKey}.maxOutputEdge`
      ),
      lossyQuality: normalizeLossyQuality(
        preset?.lossyQuality,
        `image.editorPresets.${safeKey}.lossyQuality`
      ),
    }];
  })
);

if (Object.keys(imageEditorPresets).length === 0) {
  throw new Error('image.editorPresets precisa conter pelo menos um preset.');
}

const imageOutputMimeTypes = unique(manifest.image.outputMimeTypes.map(normalizeMime));
const videoPlaybackMimeTypes = unique(manifest.video.publicPlaybackMimeTypes.map(normalizeMime));

const imageDefaultBytes = normalizePositiveInteger(
  manifest.image.limits.defaultBytes,
  'image.limits.defaultBytes'
);
const imageAvatarBytes = normalizePositiveInteger(
  manifest.image.limits.avatarBytes,
  'image.limits.avatarBytes'
);
const imagePosterBytes = normalizePositiveInteger(
  manifest.image.limits.posterBytes,
  'image.limits.posterBytes'
);
const videoDefaultBytes = normalizePositiveInteger(
  manifest.video.limits.defaultBytes,
  'video.limits.defaultBytes'
);

function q(value) {
  return JSON.stringify(value);
}

function renderGeneratedFile() {
  const imageInput = unique(imageFormats.flatMap((format) => format.mimeTypes));
  const imageExtensions = unique(imageFormats.map((format) => format.extension));
  const videoInput = unique(videoFormats.flatMap((format) => format.mimeTypes));
  const videoExtensions = unique(videoFormats.map((format) => format.extension));

  return `// AUTO-GENERATED by scripts/quality/build-media-format-policy.mjs\n// Source of truth: config/media-formats.json\n// Do not edit manually.\n\nexport const MEDIA_FORMAT_POLICY_VERSION = ${Number(manifest.version) || 1} as const;\n\nexport const IMAGE_INPUT_FORMATS = ${JSON.stringify(imageFormats, null, 2)} as const;\nexport const IMAGE_INPUT_MIME_TYPES = ${JSON.stringify(imageInput, null, 2)} as const;\nexport const IMAGE_INPUT_EXTENSIONS = ${JSON.stringify(imageExtensions, null, 2)} as const;\nexport const IMAGE_OUTPUT_MIME_TYPES = ${JSON.stringify(imageOutputMimeTypes, null, 2)} as const;\nexport const IMAGE_MAX_BYTES = ${imageDefaultBytes} as const;\nexport const AVATAR_IMAGE_MAX_BYTES = ${imageAvatarBytes} as const;\nexport const VIDEO_POSTER_IMAGE_MAX_BYTES = ${imagePosterBytes} as const;\nexport const IMAGE_EDITOR_PRESETS = ${JSON.stringify(imageEditorPresets, null, 2)} as const;\nexport const IMAGE_FORMAT_LABEL = ${q(String(manifest.image.label))} as const;\nexport const IMAGE_INPUT_ACCEPT = [...IMAGE_INPUT_MIME_TYPES, ...IMAGE_INPUT_EXTENSIONS.map((extension) => \`.\${extension}\`)].join(',');\n\nexport const VIDEO_INPUT_FORMATS = ${JSON.stringify(videoFormats, null, 2)} as const;\nexport const VIDEO_INPUT_MIME_TYPES = ${JSON.stringify(videoInput, null, 2)} as const;\nexport const VIDEO_INPUT_EXTENSIONS = ${JSON.stringify(videoExtensions, null, 2)} as const;\nexport const VIDEO_PUBLIC_PLAYBACK_MIME_TYPES = ${JSON.stringify(videoPlaybackMimeTypes, null, 2)} as const;\nexport const VIDEO_MAX_BYTES = ${videoDefaultBytes} as const;\nexport const VIDEO_FORMAT_LABEL = ${q(String(manifest.video.label))} as const;\nexport const VIDEO_INPUT_ACCEPT = [...VIDEO_INPUT_MIME_TYPES, ...VIDEO_INPUT_EXTENSIONS.map((extension) => \`.\${extension}\`)].join(',');\n\nexport const CANONICAL_VIDEO_OUTPUT = ${JSON.stringify(manifest.video.output, null, 2)} as const;\n`;
}

const generated = renderGeneratedFile();

function writeOrCheck(target) {
  if (checkOnly) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (normalizeLineEndings(current) !== normalizeLineEndings(generated)) {
      throw new Error(`Política de mídia gerada está desatualizada: ${path.relative(repoRoot, target)}`);
    }
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, generated, 'utf8');
}

writeOrCheck(frontendTarget);
writeOrCheck(functionsTarget);

console.log(
  checkOnly
    ? '[media-format] Frontend e Functions estão sincronizados com config/media-formats.json.'
    : '[media-format] Políticas de mídia geradas para Frontend e Functions.'
);
