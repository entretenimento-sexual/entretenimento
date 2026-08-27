// functions/src/media/index.ts
export { togglePhotoReaction } from './application/toggle-photo-reaction.handler';
export { toggleVideoReaction } from './application/toggle-video-reaction.handler';
export { rateVideo } from './application/rate-video.handler';
export { reportPhotoContent } from './application/report-photo-content.handler';
export { reportVideoContent } from './application/report-video-content.handler';
export {
  reviewPhotoContentReport,
} from './application/review-photo-content-report.handler';
export {
  reviewVideoContentReport,
} from './application/review-video-content-report.handler';
export {
  retryPendingModerationEvidencePreservation,
} from './application/moderation-evidence-preservation.handler';
export {
  queueHighRiskModerationLegalReview,
} from './application/moderation-legal-review.handler';

export {
  createPhotoComment,
} from './application/create-photo-comment-orchestrator.handler';
export {
  moderatePhotoComment,
} from './application/moderate-photo-comment-orchestrator.handler';

export {
  createVideoComment,
} from './application/create-video-comment-orchestrator.handler';
export {
  moderateVideoComment,
} from './application/manage-video-comment.handler';

export {
  publishPhoto,
} from './application/publish-photo-orchestrator.handler';
export {
  setCoverPhoto,
} from './application/manage-photo-publication.handler';
export {
  unpublishPhoto,
} from './application/legacy-unpublish-photo.handler';

export {
  syncPublishedPhotoOnPrivateUpdate,
} from './application/sync-published-photo-on-private-update.handler';

export {
  unpublishVideo,
} from './application/legacy-unpublish-video.handler';
export {
  publishVideo,
} from './application/publish-video-orchestrator.handler';
export {
  publishVideoWhenReady,
} from './application/publish-video-when-ready.handler';

export {
  updateVideoPublicationSettings,
} from './application/update-video-publication-settings.handler';
export {
  normalizeLegacyVideoModeration,
} from './application/normalize-legacy-video-moderation.handler';

export {
  syncPublishedVideoSettings,
} from './application/sync-published-video-settings.handler';

export {
  cleanupUnpublishedVideoInteractions,
} from './application/cleanup-unpublished-video-interactions.handler';

export {
  cleanupPendingPrivateVideoUploadAssets,
} from './application/register-private-video-upload.handler';
export {
  registerPrivateVideoUpload,
} from './application/register-private-video-upload-orchestrator.handler';

export {
  queuePrivateVideoProcessing,
} from './application/queue-video-processing.handler';

export {
  cleanupCancelledVideoProcessing,
  reconcileVideoProcessing,
  submitQueuedVideoProcessing,
} from './application/video-processing.handler';
export {
  cleanupVideoRotationInput,
} from './application/cleanup-video-rotation-input.handler';

export {
  cleanupFailedVideoUploads,
  discardFailedVideoUpload,
} from './application/discard-failed-video-upload.handler';

export {
  getVideoProcessingOperationalStatus,
} from './application/admin-video-processing-status.handler';

export {
  cleanupRetriedVideoProcessingOutputs,
  listVideoProcessingRecoveryJobs,
  recoverVideoProcessingJob,
} from './application/admin-video-processing-recovery.handler';

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

export {
  getRecentPublicMediaViews,
} from './application/get-recent-public-media-views.handler';

export {
  startPublicVideoPlaybackSession,
} from './application/start-public-video-playback-session.handler';

export {
  recordPhotoView,
} from './application/record-photo-view-orchestrator.handler';
export {
  recordVideoView,
} from './application/record-video-view-orchestrator.handler';
export {
  recordVideoRetention,
} from './application/record-video-retention-orchestrator.handler';
