export type TVideoPublicationVisibility =
  | 'PRIVATE'
  | 'FRIENDS'
  | 'SUBSCRIBERS'
  | 'PREMIUM'
  | 'PUBLIC';

export type TVideoPublicationModerationStatus =
  | 'PRIVATE'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'FLAGGED'
  | 'HIDDEN';

export type TVideoMinimumPlaybackPlan =
  | 'free'
  | 'basic'
  | 'premium'
  | 'vip';

export interface IVideoPublicationConfig {
  readonly id: string;
  readonly videoId: string;
  readonly ownerUid: string;
  readonly isPublished: boolean;
  readonly publishWhenReady?: boolean;
  readonly visibility: TVideoPublicationVisibility;
  readonly orderIndex: number;
  readonly moderationStatus: TVideoPublicationModerationStatus;
  readonly moderationReason?: string | null;
  readonly title?: string | null;
  readonly description?: string | null;
  readonly reactionsEnabled?: boolean;
  readonly commentsEnabled?: boolean;
  readonly ratingsEnabled?: boolean;
  readonly minimumPlaybackPlan?: TVideoMinimumPlaybackPlan;
  readonly publishedAt?: number | null;
  readonly updatedAt?: number | null;
}

export interface IVideoPublicationSettingsInput {
  title: string | null;
  description: string | null;
  reactionsEnabled: boolean;
  commentsEnabled: boolean;
  ratingsEnabled: boolean;
  minimumPlaybackPlan?: TVideoMinimumPlaybackPlan;
}
