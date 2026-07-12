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

export interface IVideoPublicationConfig {
  readonly id: string;
  readonly videoId: string;
  readonly ownerUid: string;
  readonly isPublished: boolean;
  readonly visibility: TVideoPublicationVisibility;
  readonly orderIndex: number;
  readonly moderationStatus: TVideoPublicationModerationStatus;
  readonly moderationReason?: string | null;
  readonly publishedAt?: number | null;
  readonly updatedAt?: number | null;
}
