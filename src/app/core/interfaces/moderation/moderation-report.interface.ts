// src/app/core/interfaces/moderation/moderation-report.interface.ts
// -----------------------------------------------------------------------------
// MODERATION REPORT INTERFACES
// -----------------------------------------------------------------------------
// Contrato mínimo para denúncia de conteúdo/usuário.
//
// Observação:
// - o documento de denúncia é privado;
// - criação vem do usuário autenticado;
// - denúncias de vídeo são validadas por Callable no backend;
// - leitura/administração deve ficar restrita à moderação/admin.
// -----------------------------------------------------------------------------

import { FieldValue, Timestamp } from 'firebase/firestore';

export type ModerationReportTargetType =
  | 'profile'
  | 'photo'
  | 'video'
  | 'video_comment'
  | 'video_rating'
  | 'message'
  | 'room'
  | 'status'
  | 'venue'
  | 'other';

export type ModerationReportReason =
  | 'spam'
  | 'fake_profile'
  | 'harassment'
  | 'hate_or_abuse'
  | 'sexual_boundary'
  | 'illegal_content'
  | 'privacy'
  | 'minor_safety'
  | 'other';

export type ModerationReportStatus =
  | 'open'
  | 'reviewing'
  | 'resolved'
  | 'rejected';

export type ModerationReportAction = 'KEEP' | 'REMOVE';

export interface IModerationReportCreateInput {
  targetType: ModerationReportTargetType;
  targetId: string;
  parentTargetId?: string | null;
  targetOwnerUid?: string | null;
  targetAuthorUid?: string | null;
  reason: ModerationReportReason;
  details?: string | null;
  route?: string | null;
}

export interface IModerationReportDocument {
  reporterUid: string;
  targetType: ModerationReportTargetType;
  targetId: string;
  parentTargetId?: string | null;
  targetOwnerUid?: string | null;
  targetAuthorUid?: string | null;
  reason: ModerationReportReason;
  details?: string | null;
  route?: string | null;
  status: ModerationReportStatus;
  moderationAction?: ModerationReportAction | null;
  source: 'web';
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface IModerationReportVm extends IModerationReportDocument {
  id: string;
}
