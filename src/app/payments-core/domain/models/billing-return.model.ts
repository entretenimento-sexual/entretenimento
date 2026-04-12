//src\app\payments-core\domain\models\billing-return.model.ts
export type BillingReturnStatus =
  | 'idle'
  | 'processing'
  | 'granted'
  | 'failed'
  | 'canceled'
  | 'login_required';

export interface BillingReturnQuery {
  billing: string | null;
  scope: string | null;
  mockProvider: string | null;
  providerSessionId: string | null;
  checkoutSessionId: string | null;
}

export interface ProcessBillingReturnInput {
  billing: string;
  scope: string;
  mockProvider?: string | null;
  providerSessionId?: string | null;
  checkoutSessionId?: string | null;
}

export interface ProcessBillingReturnResult {
  status: 'processing' | 'granted' | 'failed' | 'canceled';
  scope: string;
  role?: string | null;
  accessGranted?: boolean;
  checkoutSessionId?: string | null;
  providerSessionId?: string | null;
  redirectTo?: string | null;
  message?: string | null;
}

export interface BillingSnapshotResult {
  role?: string | null;
  tier?: string | null;
  isSubscriber?: boolean;
  entitlements?: string[];
  updatedAt?: number | null;
}

export interface BillingReturnVm {
  status: BillingReturnStatus;
  title: string;
  description: string;
  detail?: string | null;
  busy: boolean;
  primaryActionLabel?: string | null;
  secondaryActionLabel?: string | null;
}