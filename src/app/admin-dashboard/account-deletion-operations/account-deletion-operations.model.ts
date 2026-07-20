// src/app/admin-dashboard/account-deletion-operations/account-deletion-operations.model.ts
export type AccountDeletionOperationFilter =
  | 'attention'
  | 'in_progress'
  | 'blocked'
  | 'retry_scheduled'
  | 'completed'
  | 'all';

export type AccountDeletionOperationStatus =
  | 'in_progress'
  | 'blocked'
  | 'retry_scheduled'
  | 'completed'
  | 'pending';

export interface AccountDeletionOperationsCursor {
  updatedAt: number;
  reference: string;
}

export interface AccountDeletionOperationItem {
  reference: string;
  status: AccountDeletionOperationStatus;
  phase: string;
  source: 'self' | 'moderator' | 'system' | 'unknown';
  attemptCount: number;
  policyVersion: number | null;
  authDeletionStatus: string;
  firestoreDeletionStatus: string;
  dataDeletionStatus: string;
  completedDomainCount: number;
  blockingDomains: string[];
  nextAttemptAt: number | null;
  retryDelayMs: number | null;
  leaseUntil: number | null;
  lastErrorCode: string | null;
  lastErrorCategory: string | null;
  lastErrorPhase: string | null;
  deletionRequestedAt: number | null;
  deletedAt: number | null;
  purgeAfter: number | null;
  updatedAt: number;
}

export interface AccountDeletionOperationsMetrics {
  total: number;
  attention: number;
  inProgress: number;
  blocked: number;
  retryScheduled: number;
  completed: number;
}

export interface AccountDeletionOperationsResponse {
  items: AccountDeletionOperationItem[];
  metrics: AccountDeletionOperationsMetrics;
  nextCursor: AccountDeletionOperationsCursor | null;
  hasMore: boolean;
  generatedAt: number;
}

export interface AccountDeletionOperationsRequest {
  filter: AccountDeletionOperationFilter;
  limit: number;
  cursor: AccountDeletionOperationsCursor | null;
}

export interface AccountDeletionOperationsQueryState
extends AccountDeletionOperationsRequest
{
  page: number;
  refreshToken: number;
}
