import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const LOCAL_HOST = '127.0.0.1';
const LEGACY_AVATAR = /^users\/[^/]+\/published\/avatar\/avatar-[0-9]+\.(?:jpe?g|png|webp)$/;
const DOWNLOAD_TOKEN = 'firebaseStorageDownloadTokens';

export async function revokeAvatarTokens(storageOrigin, file, metadata) {
  const origin = new URL(storageOrigin);
  if (origin.protocol !== 'http:' || origin.hostname !== LOCAL_HOST ||
      !origin.port || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== origin.host ||
      !LEGACY_AVATAR.test(file.name)) {
    throw new Error('Alvo inválido para revogação local de avatar.');
  }

  const size = Number(metadata.size);
  if (!metadata.generation || !Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024) {
    throw new Error('O avatar não pôde ser regravado com segurança.');
  }
  const original = file.bucket.file(file.name, { generation: metadata.generation });
  const [bytes] = await original.download();
  if (bytes.length !== size) throw new Error('Tamanho inesperado no avatar original.');

  const customMetadata = { ...metadata.metadata };
  delete customMetadata[DOWNLOAD_TOKEN];
  // O emulador gera outro token ao excluir o último token pela API Firebase.
  // Regravar os mesmos bytes pela API Admin remove todos os tokens de download.
  await file.save(bytes, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: metadata.generation },
    metadata: {
      contentType: metadata.contentType,
      contentEncoding: metadata.contentEncoding,
      contentDisposition: metadata.contentDisposition,
      contentLanguage: metadata.contentLanguage,
      cacheControl: 'private, no-store',
      metadata: customMetadata,
    },
  });

  const [verified] = await file.getMetadata();
  if (verified.metadata?.[DOWNLOAD_TOKEN] || verified.md5Hash !== metadata.md5Hash) {
    throw new Error('A verificação do avatar após a revogação falhou.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new Error('Argumento inválido.');
  const apply = args.includes('--apply');
  const [firebase, firebaserc] = await Promise.all([
    readFile(new URL('../../firebase.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../../.firebaserc', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  const projectId = firebaserc.projects?.default;
  const hub = firebase.emulators?.hub;
  const storage = firebase.emulators?.storage;
  if (!/^[a-z0-9-]+$/.test(projectId ?? '') ||
      hub?.host !== LOCAL_HOST || storage?.host !== LOCAL_HOST ||
      !Number.isInteger(hub.port) || !Number.isInteger(storage.port)) {
    throw new Error('A configuração local do emulador é inválida.');
  }

  const hubResponse = await fetch(`http://${LOCAL_HOST}:${hub.port}/emulators`, {
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!hubResponse.ok) throw new Error('Inicie o Emulator Suite local.');
  const emulators = await hubResponse.json();
  if (emulators.storage?.host !== LOCAL_HOST || emulators.storage?.port !== storage.port) {
    throw new Error('O Storage local não corresponde ao Emulator Suite configurado.');
  }

  const host = `${LOCAL_HOST}:${storage.port}`;
  const storageOrigin = 'http://' + host;
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = host;
  process.env.STORAGE_EMULATOR_HOST = storageOrigin;
  const app = initializeApp({ projectId, storageBucket: projectId + '.appspot.com' });
  try {
    const bucket = getStorage(app).bucket();
    let page = { prefix: 'users/', maxResults: 200, autoPaginate: false };
    let candidates = 0;
    let completed = 0;

    while (page) {
      const [files, nextPage] = await bucket.getFiles(page);
      for (const file of files) {
        if (!LEGACY_AVATAR.test(file.name)) continue;
        const [metadata] = await file.getMetadata();
        const tokens = String(metadata.metadata?.[DOWNLOAD_TOKEN] ?? '')
          .split(',').map((value) => value.trim()).filter(Boolean);
        if (!tokens.length) continue;

        candidates++;
        if (!apply) continue;
        await revokeAvatarTokens(storageOrigin, file, metadata);
        completed++;
      }
      page = nextPage;
    }

    console.log(`Avatares legados com token: ${candidates}. Revogados: ${completed}.`);
    if (!apply) console.log('Para revogar no Storage Emulator, execute novamente com --apply.');
  } finally {
    await deleteApp(app);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error('A operação no Storage Emulator foi interrompida.', error.message);
    process.exitCode = 1;
  });
}
