import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeOwnedMediaAndStorageDomain,
  type AccountOwnedMediaDeletionAdapter,
  type OwnedMediaCleanupJobKind,
  type OwnedVideoProcessingPageSummary,
} from './account-owned-media-deletion.executor';

class FakeOwnedMediaAdapter implements AccountOwnedMediaDeletionAdapter {
  photos: number[] = [0];
  videos: number[] = [0];
  photoPublications: number[] = [0];
  videoPublications: number[] = [0];
  imageStates: number[] = [0];
  publicProjection = 0;
  processing: OwnedVideoProcessingPageSummary[] = [
    { scanned: 0, processed: 0, blocking: 0 },
  ];
  storageObjects: number[] = [0];
  cleanupJobs: Record<OwnedMediaCleanupJobKind, number[]> = {
    photo_deletion: [0],
    video_deletion: [0],
    published_photo_asset: [0],
    published_video_asset: [0],
  };
  storageCalls = 0;
  error: unknown = null;

  async deleteOwnedPhotosPage(): Promise<number> {
    if (this.error) throw this.error;
    return this.photos.shift() ?? 0;
  }

  async deleteOwnedVideosPage(): Promise<number> {
    return this.videos.shift() ?? 0;
  }

  async deleteOwnedPhotoPublicationsPage(): Promise<number> {
    return this.photoPublications.shift() ?? 0;
  }

  async deleteOwnedVideoPublicationsPage(): Promise<number> {
    return this.videoPublications.shift() ?? 0;
  }

  async deleteOwnedImageStatesPage(): Promise<number> {
    return this.imageStates.shift() ?? 0;
  }

  async deleteOwnedPublicMediaProjection(): Promise<number> {
    return this.publicProjection;
  }

  async resolveOwnedVideoProcessingJobsPage(): Promise<OwnedVideoProcessingPageSummary> {
    return this.processing.shift() ?? {
      scanned: 0,
      processed: 0,
      blocking: 0,
    };
  }

  async deleteOwnedStorageObjectsPage(): Promise<number> {
    this.storageCalls += 1;
    return this.storageObjects.shift() ?? 0;
  }

  async deleteOwnedMediaCleanupJobsPage(
    _uid: string,
    kind: OwnedMediaCleanupJobKind
  ): Promise<number> {
    return this.cleanupJobs[kind].shift() ?? 0;
  }
}

test('owned media domain completes metadata, processing, storage and durable jobs', async () => {
  const adapter = new FakeOwnedMediaAdapter();
  adapter.photos = [2];
  adapter.videos = [1];
  adapter.photoPublications = [1];
  adapter.videoPublications = [1];
  adapter.imageStates = [2];
  adapter.publicProjection = 1;
  adapter.processing = [{ scanned: 1, processed: 1, blocking: 0 }];
  adapter.storageObjects = [3];
  adapter.cleanupJobs = {
    photo_deletion: [1],
    video_deletion: [1],
    published_photo_asset: [2],
    published_video_asset: [2],
  };

  const result = await executeOwnedMediaAndStorageDomain(adapter, {
    uid: 'media-owner',
    pageSize: 10,
    maxPagesPerStep: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.processed, 18);
  assert.equal(result.blocker, undefined);
  assert.deepEqual(result.details, {
    photosProcessed: 2,
    videosProcessed: 1,
    photoPublicationsProcessed: 1,
    videoPublicationsProcessed: 1,
    imageStatesProcessed: 2,
    publicProjectionProcessed: 1,
    processingJobsProcessed: 1,
    processingJobsBlocking: 0,
    storageObjectsDeleted: 3,
    photoDeletionJobsDeleted: 1,
    videoDeletionJobsDeleted: 1,
    publishedPhotoCleanupJobsDeleted: 2,
    publishedVideoCleanupJobsDeleted: 2,
  });
});

test('active video processing blocks finalization before storage namespace deletion', async () => {
  const adapter = new FakeOwnedMediaAdapter();
  adapter.processing = [{ scanned: 1, processed: 0, blocking: 1 }];

  const result = await executeOwnedMediaAndStorageDomain(adapter, {
    uid: 'processing-owner',
    pageSize: 10,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.blocker, 'video-processing-cancellation-pending');
  assert.equal(result.details?.['processingJobsBlocking'], 1);
  assert.equal(adapter.storageCalls, 0);
});

test('metadata pagination limit returns partial without advancing to storage', async () => {
  const adapter = new FakeOwnedMediaAdapter();
  adapter.photos = [2, 2];

  const result = await executeOwnedMediaAndStorageDomain(adapter, {
    uid: 'media-pagination-owner',
    pageSize: 2,
    maxPagesPerStep: 2,
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.blocker, 'pagination-limit-reached');
  assert.equal(result.details?.['photosProcessed'], 4);
  assert.equal(adapter.storageCalls, 0);
});

test('owned media domain isolates adapter failures in the domain result', async () => {
  const adapter = new FakeOwnedMediaAdapter();
  adapter.error = Object.assign(new Error('storage unavailable'), {
    code: 'storage/unavailable',
  });

  const result = await executeOwnedMediaAndStorageDomain(adapter, {
    uid: 'media-error-owner',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'storage/unavailable');
  assert.equal(result.details?.['errorMessage'], 'storage unavailable');
});

test('invalid uid fails closed before calling the adapter', async () => {
  const adapter = new FakeOwnedMediaAdapter();

  const result = await executeOwnedMediaAndStorageDomain(adapter, {
    uid: '../invalid',
  });

  assert.equal(result.status, 'failed');
  assert.equal(adapter.storageCalls, 0);
});
