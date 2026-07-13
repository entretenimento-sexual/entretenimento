// functions/src/media/index.ts
export { togglePhotoReaction } from './application/toggle-photo-reaction.handler';

export {
  createPhotoComment,
  moderatePhotoComment,
} from './application/manage-photo-comment.handler';

export {
  publishPhoto,
  unpublishPhoto,
  setCoverPhoto,
} from './application/manage-photo-publication.handler';

export {
  publishVideo,
  unpublishVideo,
} from './application/manage-video-publication.handler';

export {
  cleanupPendingPrivateVideoUploadAssets,
  registerPrivateVideoUpload,
} from './application/register-private-video-upload.handler';

export {
  queuePrivateVideoProcessing,
} from './application/queue-video-processing.handler';

export {
  cleanupCancelledVideoProcessing,
  reconcileVideoProcessing,
  submitQueuedVideoProcessing,
} from './application/video-processing.handler';

export {
  listVideoModerationQueue,
  reviewVideoModeration,
} from './application/admin-video-moderation.handler';

export {
  cleanupPendingPhotoDeletions,
  deleteProfilePhoto,
} from './application/delete-profile-photo.handler';

export {
  cleanupPendingVideoDeletions,
  deleteProfileVideo,
} from './application/delete-profile-video.handler';

export {
  cleanupPendingPublishedPhotoAssets,
} from './application/cleanup-published-photo-assets.handler';

export {
  cleanupPendingPublishedVideoAssets,
} from './application/cleanup-published-video-assets.handler';

export {
  getPrivateVideoAccessUrls,
} from './application/get-private-video-access-urls.handler';

export {
  getPublicPhotoAccessUrls,
} from './application/get-public-photo-access-urls.handler';

export {
  getPublicVideoAccessUrls,
} from './application/get-public-video-access-urls.handler';

export { recordPhotoView } from './application/record-photo-view.handler';
export { recordVideoView } from './application/record-video-view.handler';
