import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PhotoPublicationDoc,
  PhotoSyncCommit,
  PhotoSyncDependencies,
  synchronizePublishedPhotoUpdate,
} from './sync-published-photo-on-private-update.use-case';

const OWNER_UID = 'owner-1';
const PHOTO_ID = 'photo-1';
const OLD_PRIVATE_PATH = `users/${OWNER_UID}/uploads/images/old.jpg`;
const NEW_PRIVATE_PATH = `users/${OWNER_UID}/uploads/images/new.jpg`;
const OLD_PUBLIC_PATH = `users/${OWNER_UID}/published/images/${PHOTO_ID}/old-version`;
const NEW_PUBLIC_PATH = `users/${OWNER_UID}/published/images/${PHOTO_ID}/new-version`;

interface HarnessOptions {
  publication?: PhotoPublicationDoc | null;
  copyResult?: string;
  copyError?: Error;
  now?: number;
  moderationStatus?: 'PENDING_REVIEW' | 'APPROVED';
}

function createHarness(options: HarnessOptions = {}) {
  const copyCalls: Array<{
    ownerUid: string;
    photoId: string;
    sourceStoragePath: string;
  }> = [];
  const commitCalls: PhotoSyncCommit[] = [];
  const deleteCalls: Array<{
    ownerUid: string;
    photoId: string;
    storagePath: string;
    reason: string;
  }> = [];
  const metricCalls: string[] = [];
  const logs: Array<{
    message: string;
    context: Record<string, unknown>;
  }> = [];
  const publication = Object.prototype.hasOwnProperty.call(options, 'publication')
    ? options.publication ?? null
    : {
        isPublished: true,
        sourceStoragePath: OLD_PRIVATE_PATH,
        publishedStoragePath: OLD_PUBLIC_PATH,
      };

  const dependencies: PhotoSyncDependencies = {
    moderationStatus: options.moderationStatus ?? 'APPROVED',
    now: () => options.now ?? 123456,
    loadPublication: async () => publication,
    copyPublishedAsset: async (command) => {
      copyCalls.push(command);

      if (options.copyError) {
        throw options.copyError;
      }

      return options.copyResult ?? NEW_PUBLIC_PATH;
    },
    commitPatches: async (commit) => {
      commitCalls.push(commit);
    },
    deletePublishedAsset: async (command) => {
      deleteCalls.push(command);
      return true;
    },
    refreshMetrics: async (ownerUid) => {
      metricCalls.push(ownerUid);
    },
    logError: (message, context) => {
      logs.push({ message, context });
    },
  };

  return {
    dependencies,
    copyCalls,
    commitCalls,
    deleteCalls,
    metricCalls,
    logs,
  };
}

describe('synchronizePublishedPhotoUpdate', () => {
  it('substitui o ativo publicado e remove a versão anterior', async () => {
    const harness = createHarness();

    const result = await synchronizePublishedPhotoUpdate(
      {
        ownerUid: OWNER_UID,
        photoId: PHOTO_ID,
        before: {
          path: OLD_PRIVATE_PATH,
          fileName: 'foto.jpg',
          alt: 'Foto do perfil',
        },
        after: {
          path: NEW_PRIVATE_PATH,
          fileName: 'foto.jpg',
          alt: 'Foto do perfil',
        },
      },
      harness.dependencies
    );

    assert.deepEqual(result, {
      status: 'synchronized',
      binaryChanged: true,
      metadataChanged: false,
      copiedAsset: true,
      moderationStatus: 'APPROVED',
    });
    assert.deepEqual(harness.copyCalls, [
      {
        ownerUid: OWNER_UID,
        photoId: PHOTO_ID,
        sourceStoragePath: NEW_PRIVATE_PATH,
      },
    ]);
    assert.equal(harness.commitCalls.length, 1);
    assert.deepEqual(harness.commitCalls[0].publicationPatch, {
      updatedAt: 123456,
      sourceStoragePath: NEW_PRIVATE_PATH,
      publishedStoragePath: NEW_PUBLIC_PATH,
      assetVersion: 123456,
      moderationStatus: 'APPROVED',
      moderationReason: null,
      lastModeratedAt: 123456,
    });
    assert.deepEqual(harness.commitCalls[0].publicPhotoPatch, {
      alt: 'Foto do perfil',
      updatedAt: 123456,
      moderationStatus: 'APPROVED',
      moderationReason: null,
    });
    assert.deepEqual(harness.deleteCalls, [
      {
        ownerUid: OWNER_UID,
        photoId: PHOTO_ID,
        storagePath: OLD_PUBLIC_PATH,
        reason: 'sync-published-photo-replace-version',
      },
    ]);
    assert.deepEqual(harness.metricCalls, [OWNER_UID]);
  });

  it('atualiza apenas metadados sem copiar ou excluir arquivos', async () => {
    const harness = createHarness();

    const result = await synchronizePublishedPhotoUpdate(
      {
        ownerUid: OWNER_UID,
        photoId: PHOTO_ID,
        before: {
          path: OLD_PRIVATE_PATH,
          fileName: 'foto.jpg',
          alt: 'Legenda antiga',
        },
        after: {
          path: OLD_PRIVATE_PATH,
          fileName: 'foto.jpg',
          alt: 'Legenda nova',
        },
      },
      harness.dependencies
    );

    assert.deepEqual(result, {
      status: 'synchronized',
      binaryChanged: false,
      metadataChanged: true,
      copiedAsset: false,
      moderationStatus: 'APPROVED',
    });
    assert.equal(harness.copyCalls.length, 0);
    assert.equal(harness.deleteCalls.length, 0);
    assert.deepEqual(harness.commitCalls, [
      {
        ownerUid: OWNER_UID,
        photoId: PHOTO_ID,
        publicationPatch: {
          updatedAt: 123456,
        },
        publicPhotoPatch: {
          alt: 'Legenda nova',
          updatedAt: 123456,
        },
      },
    ]);
    assert.deepEqual(harness.metricCalls, [OWNER_UID]);
  });

  it('trata retry já sincronizado como operação idempotente', async () => {
    const harness = createHarness({
      publication: {
        isPublished: true,
        sourceStoragePath: NEW_PRIVATE_PATH,
        publishedStoragePath: NEW_PUBLIC_PATH,
      },
    });

    const result = await synchronizePublishedPhotoUpdate(
      {
        ownerUid: OWNER_UID,
        photoId: PHOTO_ID,
        before: {
          path: OLD_PRIVATE_PATH,
          fileName: 'foto.jpg',
        },
        after: {
          path: NEW_PRIVATE_PATH,
          fileName: 'foto.jpg',
        },
      },
      harness.dependencies
    );

    assert.deepEqual(result, {
      status: 'already-synchronized',
      binaryChanged: true,
      metadataChanged: false,
      copiedAsset: false,
      moderationStatus: 'APPROVED',
    });
    assert.equal(harness.copyCalls.length, 0);
    assert.equal(harness.commitCalls.length, 0);
    assert.equal(harness.deleteCalls.length, 0);
    assert.equal(harness.metricCalls.length, 0);
  });

  it('interrompe sem gravar quando o arquivo privado não existe', async () => {
    const missingFileError = new Error(
      'O arquivo privado da foto não foi encontrado.'
    );
    const harness = createHarness({ copyError: missingFileError });

    await assert.rejects(
      () =>
        synchronizePublishedPhotoUpdate(
          {
            ownerUid: OWNER_UID,
            photoId: PHOTO_ID,
            before: {
              path: OLD_PRIVATE_PATH,
              fileName: 'foto.jpg',
            },
            after: {
              path: NEW_PRIVATE_PATH,
              fileName: 'foto.jpg',
            },
          },
          harness.dependencies
        ),
      missingFileError
    );

    assert.equal(harness.copyCalls.length, 1);
    assert.equal(harness.commitCalls.length, 0);
    assert.equal(harness.deleteCalls.length, 0);
    assert.equal(harness.metricCalls.length, 0);
  });
});
