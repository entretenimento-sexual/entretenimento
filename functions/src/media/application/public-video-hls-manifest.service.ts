import { posix } from 'node:path';

import { storage } from '../../firebaseApp';
import { createTemporaryStorageReadUrl } from './temporary-storage-read-url.service';

export interface PublicVideoHlsPlaylist {
  placeholder: string;
  manifest: string;
}

export interface PublicVideoHlsBundle {
  masterManifest: string;
  playlists: PublicVideoHlsPlaylist[];
  expiresAt: number;
  playlistCount: number;
  segmentCount: number;
}

export interface BuildPublicVideoHlsBundleCommand {
  masterStoragePath: string;
  expiresAt: number;
  readTextFile?: (storagePath: string) => Promise<string>;
  signReadUrl?: (storagePath: string, expiresAt: number) => Promise<string>;
}

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_MEDIA_PLAYLISTS = 8;
const MAX_MEDIA_ASSETS = 1_200;
const MAX_RESPONSE_CHARACTERS = 2_500_000;
const HLS_PLAYLIST_CONTENT_TYPE = 'application/vnd.apple.mpegurl';
const ALLOWED_MEDIA_EXTENSIONS = new Set([
  '.ts',
  '.m4s',
  '.mp4',
  '.aac',
  '.mp3',
  '.vtt',
  '.webvtt',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function normalizeStoragePath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function normalizeManifestText(value: string, storagePath: string): string {
  const byteLength = Buffer.byteLength(value, 'utf8');

  if (!value || byteLength > MAX_MANIFEST_BYTES) {
    throw new Error(`Manifest HLS inválido ou excessivo: ${storagePath}.`);
  }

  const normalized = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  if (!normalized.startsWith('#EXTM3U')) {
    throw new Error(`O arquivo não é um manifest HLS válido: ${storagePath}.`);
  }

  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function outputPrefixFromMaster(masterStoragePath: string): string {
  const normalized = normalizeStoragePath(masterStoragePath);

  if (!normalized || posix.basename(normalized).toLowerCase() !== 'manifest.m3u8') {
    throw new Error('Caminho do manifest HLS principal inválido.');
  }

  const directory = posix.dirname(normalized);
  return directory === '.' ? '' : `${directory}/`;
}

function decodeReference(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('Referência HLS possui codificação inválida.');
  }
}

function resolveOwnedReference(
  outputPrefix: string,
  playlistStoragePath: string,
  rawReference: string
): string {
  const normalizedReference = String(rawReference ?? '').trim();

  if (
    !normalizedReference ||
    normalizedReference.length > 1_024 ||
    containsControlCharacter(normalizedReference) ||
    normalizedReference.includes('\\') ||
    normalizedReference.startsWith('/') ||
    normalizedReference.startsWith('//') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalizedReference) ||
    normalizedReference.includes('?') ||
    normalizedReference.includes('#')
  ) {
    throw new Error('Manifest HLS contém referência externa ou inválida.');
  }

  const decodedReference = decodeReference(normalizedReference);
  const playlistDirectory = posix.dirname(playlistStoragePath);
  const resolved = normalizeStoragePath(
    posix.normalize(posix.join(playlistDirectory, decodedReference))
  );

  if (
    !resolved ||
    !outputPrefix ||
    !resolved.startsWith(outputPrefix) ||
    resolved === outputPrefix.slice(0, -1)
  ) {
    throw new Error('Manifest HLS tentou sair do namespace processado.');
  }

  return resolved;
}

function assertPlaylistPath(storagePath: string): void {
  if (posix.extname(storagePath).toLowerCase() !== '.m3u8') {
    throw new Error('Manifest principal referencia um arquivo que não é playlist.');
  }
}

function assertMediaAssetPath(storagePath: string): void {
  const extension = posix.extname(storagePath).toLowerCase();

  if (!ALLOWED_MEDIA_EXTENSIONS.has(extension)) {
    throw new Error(`Extensão HLS não autorizada: ${extension || 'sem extensão'}.`);
  }
}

async function replaceUriAttributes(
  line: string,
  replaceUri: (uri: string) => Promise<string>
): Promise<string> {
  const matches = [...line.matchAll(/URI="([^"]+)"/g)];

  if (!matches.length) {
    return line;
  }

  let output = '';
  let cursor = 0;

  for (const match of matches) {
    const index = match.index ?? 0;
    const original = match[0];
    const uri = match[1];
    const replacement = await replaceUri(uri);

    output += line.slice(cursor, index);
    output += `URI="${replacement}"`;
    cursor = index + original.length;
  }

  return output + line.slice(cursor);
}

async function rewriteManifest(
  manifest: string,
  replaceUri: (uri: string) => Promise<string>
): Promise<string> {
  const output: string[] = [];

  for (const line of manifest.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) {
      output.push(line);
      continue;
    }

    if (trimmed.startsWith('#')) {
      output.push(await replaceUriAttributes(line, replaceUri));
      continue;
    }

    output.push(await replaceUri(trimmed));
  }

  return output.join('\n');
}

async function defaultReadTextFile(storagePath: string): Promise<string> {
  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new Error(`Arquivo HLS não encontrado: ${storagePath}.`);
  }

  const [contents] = await file.download();
  return contents.toString('utf8');
}

async function defaultSignReadUrl(
  storagePath: string,
  expiresAt: number
): Promise<string> {
  return createTemporaryStorageReadUrl(storagePath, expiresAt);
}

/**
 * Constrói uma sessão HLS efêmera sem expor caminhos do Storage.
 *
 * O manifest principal e as playlists de mídia retornam como texto. Todas as
 * referências a segmentos são substituídas por URLs temporárias. O Angular
 * materializa os manifests em Blob URLs somente durante a reprodução.
 */
export async function buildPublicVideoHlsBundle(
  command: BuildPublicVideoHlsBundleCommand
): Promise<PublicVideoHlsBundle> {
  const masterStoragePath = normalizeStoragePath(command.masterStoragePath);
  const outputPrefix = outputPrefixFromMaster(masterStoragePath);
  const expiresAt = Number(command.expiresAt);

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Expiração da sessão HLS inválida.');
  }

  const readTextFile = command.readTextFile ?? defaultReadTextFile;
  const signReadUrl = command.signReadUrl ?? defaultSignReadUrl;
  const masterSource = normalizeManifestText(
    await readTextFile(masterStoragePath),
    masterStoragePath
  );
  const playlistPlaceholders = new Map<string, string>();
  const orderedPlaylistPaths: string[] = [];

  const masterManifest = await rewriteManifest(
    masterSource,
    async (reference) => {
      const storagePath = resolveOwnedReference(
        outputPrefix,
        masterStoragePath,
        reference
      );
      assertPlaylistPath(storagePath);

      let placeholder = playlistPlaceholders.get(storagePath);

      if (!placeholder) {
        if (orderedPlaylistPaths.length >= MAX_MEDIA_PLAYLISTS) {
          throw new Error('Manifest HLS excede o limite de playlists de mídia.');
        }

        placeholder = `__ENTRETENIMENTO_HLS_PLAYLIST_${orderedPlaylistPaths.length}__`;
        playlistPlaceholders.set(storagePath, placeholder);
        orderedPlaylistPaths.push(storagePath);
      }

      return placeholder;
    }
  );

  if (!orderedPlaylistPaths.length) {
    throw new Error('Manifest HLS não contém playlists de mídia autorizáveis.');
  }

  const signedUrlCache = new Map<string, Promise<string>>();
  let mediaAssetCount = 0;

  const signMediaAsset = async (
    playlistStoragePath: string,
    reference: string
  ): Promise<string> => {
    const storagePath = resolveOwnedReference(
      outputPrefix,
      playlistStoragePath,
      reference
    );
    assertMediaAssetPath(storagePath);
    mediaAssetCount += 1;

    if (mediaAssetCount > MAX_MEDIA_ASSETS) {
      throw new Error('Manifest HLS excede o limite de segmentos autorizáveis.');
    }

    let signedUrl = signedUrlCache.get(storagePath);

    if (!signedUrl) {
      signedUrl = signReadUrl(storagePath, expiresAt);
      signedUrlCache.set(storagePath, signedUrl);
    }

    return signedUrl;
  };

  const playlists = await Promise.all(
    orderedPlaylistPaths.map(async (playlistStoragePath) => {
      const source = normalizeManifestText(
        await readTextFile(playlistStoragePath),
        playlistStoragePath
      );
      const manifest = await rewriteManifest(
        source,
        (reference) => signMediaAsset(playlistStoragePath, reference)
      );

      return {
        placeholder: playlistPlaceholders.get(playlistStoragePath)!,
        manifest,
      };
    })
  );
  const responseCharacters = masterManifest.length + playlists.reduce(
    (total, playlist) => total + playlist.manifest.length,
    0
  );

  if (responseCharacters > MAX_RESPONSE_CHARACTERS) {
    throw new Error('Sessão HLS excede o tamanho seguro de resposta.');
  }

  return {
    masterManifest,
    playlists,
    expiresAt: Math.trunc(expiresAt),
    playlistCount: playlists.length,
    segmentCount: signedUrlCache.size,
  };
}

export const PUBLIC_VIDEO_HLS_CONFIGURATION = {
  playlistContentType: HLS_PLAYLIST_CONTENT_TYPE,
  maxMediaPlaylists: MAX_MEDIA_PLAYLISTS,
  maxMediaAssets: MAX_MEDIA_ASSETS,
} as const;
