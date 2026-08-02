// functions/src/media/index.ts
export {
  authorizePublicVideoShare,
  createPhotoComment,
  createVideoComment,
  moderatePhotoComment,
  moderateVideoComment,
  rateVideo,
  reportVideoContent,
  reviewVideoContentReport,
  togglePhotoReaction,
  toggleVideoReaction,
} from './application/protected-media-callables.handler';

export {
  getPrivateVideoAccessUrls,
  getPublicPhotoAccessUrls,
  getPublicVideoAccessUrls,
  listAuthorizedPublicVideos,
} from './application/protected-media-access-callables.handler';

export {
  deleteProfilePhoto,
  deleteProfileVideo,
  publishPhoto,
  publishVideo,
  registerPrivateVideoUpload,
  setCoverPhoto,
  unpublishPhoto,
  unpublishVideo,
  updateVideoPublicationSettings,
} from './application/protected-media-lifecycle-callables.handler';

export {
  cleanupMediaCallableRateLimits,
} from './application/media-callable-rate-limit.service';
export {
  cleanupMediaMutationIdempotency,
} from './application/media-mutation-idempotency.service';

export {
  syncPublishedPhotoOnPrivateUpdate,
} from './application/sync-published-photo-on-private-update.handler';

export {
  publishVideoWhenReady,
} from './application/publish-video-when-ready.handler';

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
  queuePrivateVideoProcessing,
} from './application/queue-video-processing.handler';

export {
  cleanupCancelledVideoProcessing,
  reconcileVideoProcessing,
  submitQueuedVideoProcessing,
} from './application/video-processing.handler';

export {
  getVideoProcessingOperationalStatus,
} from './application/admin-video-processing-status.handler';

export {
  cleanupRetriedVideoProcessingOutputs,
  listVideoProcessingRecoveryJobs,
  recoverVideoProcessingJob,
} from './application/admin-video-processing-recovery.handler';

export {
  listVideoModerationQueue,
  reviewVideoModeration,
} from './application/admin-video-moderation.handler';

export {
  cleanupPendingPhotoDeletions,
} from './application/delete-profile-photo.handler';

export {
  cleanupPendingVideoDeletions,
} from './application/delete-profile-video.handler';

export {
  cleanupPendingPublishedPhotoAssets,
} from './application/cleanup-published-photo-assets.handler';

export {
  cleanupPendingPublishedVideoAssets,
} from './application/cleanup-published-video-assets.handler';

export {
  issueVideoViewSession,
  cleanupExpiredVideoViewSessions,
} from './application/issue-video-view-session.handler';
export {
  recordPhotoView,
} from './application/record-photo-view-orchestrator.handler';
export {
  recordVideoView,
} from './application/record-video-view-orchestrator.handler';

export {
  recalculateVideoRankingOnWrite,
  refreshPublicVideoRankingScores,
} from './application/video-ranking-score-maintenance.handler';
