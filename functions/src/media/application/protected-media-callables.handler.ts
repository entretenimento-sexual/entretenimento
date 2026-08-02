import { onCall } from 'firebase-functions/v2/https';

import { PROTECTED_CALLABLE_OPTIONS } from '../../config/protected-callable-options';
import {
  authorizePublicVideoShare as authorizePublicVideoShareCore,
} from './authorize-public-video-share.handler';
import {
  createPhotoComment as createPhotoCommentCore,
  moderatePhotoComment as moderatePhotoCommentCore,
} from './manage-photo-comment.handler';
import {
  createVideoComment as createVideoCommentCore,
  moderateVideoComment as moderateVideoCommentCore,
} from './manage-video-comment.handler';
import {
  assertMediaCallableRateLimit,
} from './media-callable-rate-limit.service';
import {
  rateVideo as rateVideoCore,
} from './rate-video.handler';
import {
  reportVideoContent as reportVideoContentCore,
  type VideoReportReason,
  type VideoReportTargetType,
} from './report-video-content.handler';
import {
  reviewVideoContentReport as reviewVideoContentReportCore,
  type VideoContentReportDecision,
} from './review-video-content-report.handler';
import {
  togglePhotoReaction as togglePhotoReactionCore,
} from './toggle-photo-reaction.handler';
import {
  toggleVideoReaction as toggleVideoReactionCore,
} from './toggle-video-reaction.handler';

interface PhotoTargetRequest {
  ownerUid?: string;
  photoId?: string;
}

interface VideoTargetRequest {
  ownerUid?: string;
  videoId?: string;
}

interface CreatePhotoCommentRequest extends PhotoTargetRequest {
  content?: string;
  parentCommentId?: string | null;
}

interface ModeratePhotoCommentRequest extends PhotoTargetRequest {
  commentId?: string;
  action?: 'HIDE' | 'RESTORE' | 'DELETE';
}

interface CreateVideoCommentRequest extends VideoTargetRequest {
  content?: string;
  parentCommentId?: string | null;
}

interface ModerateVideoCommentRequest extends VideoTargetRequest {
  commentId?: string;
  action?: 'HIDE' | 'RESTORE' | 'DELETE';
}

interface RateVideoRequest extends VideoTargetRequest {
  rating?: number;
}

interface ReportVideoContentRequest extends VideoTargetRequest {
  targetType?: VideoReportTargetType;
  targetId?: string | null;
  reason?: VideoReportReason;
  details?: string | null;
  route?: string | null;
}

interface ReviewVideoContentReportRequest {
  reportId?: string;
  decision?: VideoContentReportDecision;
  resolution?: string | null;
}

function cleanActorUid(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function keyPart(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized
    ? normalized.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128)
    : 'invalid';
}

async function consumeLimit(input: {
  actorUid: unknown;
  action:
    | 'REACTION'
    | 'COMMENT_CREATE'
    | 'COMMENT_MODERATE'
    | 'RATING'
    | 'REPORT'
    | 'REPORT_MODERATE'
    | 'SHARE_AUTHORIZE';
  resourceKey: string;
}): Promise<void> {
  const actorUid = cleanActorUid(input.actorUid);

  if (!actorUid) {
    return;
  }

  await assertMediaCallableRateLimit({
    actorUid,
    action: input.action,
    resourceKey: input.resourceKey,
  });
}

export const togglePhotoReaction = onCall<PhotoTargetRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    await consumeLimit({
      actorUid: request.auth?.uid,
      action: 'REACTION',
      resourceKey: [
        'photo',
        keyPart(request.data?.ownerUid),
        keyPart(request.data?.photoId),
      ].join(':'),
    });

    return togglePhotoReactionCore.run(request);
  }
);

export const toggleVideoReaction = onCall<VideoTargetRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    await consumeLimit({
      actorUid: request.auth?.uid,
      action: 'REACTION',
      resourceKey: [
        'video',
        keyPart(request.data?.ownerUid),
        keyPart(request.data?.videoId),
      ].join(':'),
    });

    return toggleVideoReactionCore.run(request);
  }
);

export const createPhotoComment = onCall<CreatePhotoCommentRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    await consumeLimit({
      actorUid: request.auth?.uid,
      action: 'COMMENT_CREATE',
      resourceKey: [
        'photo',
        keyPart(request.data?.ownerUid),
        keyPart(request.data?.photoId),
        keyPart(request.data?.parentCommentId ?? 'root'),
      ].join(':'),
    });

    return createPhotoCommentCore.run(request);
  }
);

export const createVideoComment = onCall<CreateVideoCommentRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    await consumeLimit({
      actorUid: request.auth?.uid,
      action: 'COMMENT_CREATE',
      resourceKey: [
        'video',
        keyPart(request.data?.ownerUid),
        keyPart(request.data?.videoId),
        keyPart(request.data?.parentCommentId ?? 'root'),
      ].join(':'),
    });

    return createVideoCommentCore.run(request);
  }
);

export const moderatePhotoComment = onCall<ModeratePhotoCommentRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    await consumeLimit({
      actorUid: request.auth?.uid,
      action: 'COMMENT_MODERATE',
      resourceKey: [
        'photo',
        keyPart(request.data?.ownerUid),
        keyPart(request.data?.photoId),
        keyPart(request.data?.commentId),
      ].join(':'),
    });

    return moderatePhotoCommentCore.run(request);
  }
);

export const moderateVideoComment = onCall<ModerateVideoCommentRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    await consumeLimit({
      actorUid: request.auth?.uid,
      action: 'COMMENT_MODERATE',
      resourceKey: [
        'video',
        keyPart(request.data?.ownerUid),
        keyPart(request.data?.videoId),
        keyPart(request.data?.commentId),
      ].join(':'),
    });

    return moderateVideoCommentCore.run(request);
  }
);

export const rateVideo = onCall<RateVideoRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    await consumeLimit({
      actorUid: request.auth?.uid,
      action: 'RATING',
      resourceKey: [
        'video',
        keyPart(request.data?.ownerUid),
        keyPart(request.data?.videoId),
      ].join(':'),
    });

    return rateVideoCore.run(request);
  }
);

export const reportVideoContent = onCall<ReportVideoContentRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    await consumeLimit({
      actorUid: request.auth?.uid,
      action: 'REPORT',
      resourceKey: [
        keyPart(request.data?.targetType),
        keyPart(request.data?.ownerUid),
        keyPart(request.data?.videoId),
        keyPart(request.data?.targetId ?? request.data?.videoId),
      ].join(':'),
    });

    return reportVideoContentCore.run(request);
  }
);

export const reviewVideoContentReport = onCall<
  ReviewVideoContentReportRequest
>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    await consumeLimit({
      actorUid: request.auth?.uid,
      action: 'REPORT_MODERATE',
      resourceKey: `report:${keyPart(request.data?.reportId)}`,
    });

    return reviewVideoContentReportCore.run(request);
  }
);

export const authorizePublicVideoShare = onCall<VideoTargetRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  async (request) => {
    await consumeLimit({
      actorUid: request.auth?.uid,
      action: 'SHARE_AUTHORIZE',
      resourceKey: [
        'video',
        keyPart(request.data?.ownerUid),
        keyPart(request.data?.videoId),
      ].join(':'),
    });

    return authorizePublicVideoShareCore.run(request);
  }
);
