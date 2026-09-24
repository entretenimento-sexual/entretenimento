// src/app/payments-core/domain/models/billing-return.model.ts
// -----------------------------------------------------------------------------
// BILLING RETURN MODELS
// -----------------------------------------------------------------------------
// A URL de retorno não confirma pagamento. Acesso vem do snapshot sanitizado do
// entitlement válido, retornado pelo backend.
// -----------------------------------------------------------------------------

export type BillingReturnStatus =
  | 'idle'
  | 'processing'
  | 'granted'
  | 'failed'
  | 'canceled'
  | 'login_required';

export type BillingGrantedRole = 'basic' | 'premium' | 'vip';

export interface BillingReturnQuery {
  billing: string | null;
  scope: string | null;
  checkoutSessionId: string | null;
  minimumRole: BillingGrantedRole | null;
  returnUrl: string | null;
}

export interface ProcessBillingReturnInput {
  billing: string;
  scope: string;
  checkoutSessionId: string;
}

export interface ProcessBillingReturnResult {
  status: 'processing' | 'granted' | 'failed' | 'canceled';
  scope: string;
  role?: BillingGrantedRole | null;
  accessGranted?: boolean;
  checkoutSessionId?: string | null;
  redirectTo?: string | null;
  message?: string | null;
}

export interface BillingSnapshotResult {
  role?: BillingGrantedRole | null;
  tier?: BillingGrantedRole | null;
  isSubscriber?: boolean;
  status?: 'active' | 'inactive';
  entitlements?: string[];
  startsAt?: number | null;
  endsAt?: number | null;
  updatedAt?: number | null;
  projectionVersion?: number | null;
  recurringConfigured?: boolean;
  renewalEnabled?: boolean;
  renewalStatus?: 'active' | 'cancel_pending' | 'canceled' | 'none';
  renewalCancellationPending?: boolean;
  downgradeSchedulingAvailable?: boolean;
  scheduledPlanChange?: {
    planKey: BillingGrantedRole;
    effectiveAt: number;
    providerUpdateStatus: 'applied' | 'pending';
  } | null;
}

export interface SchedulePlatformSubscriptionDowngradeResult {
  scheduled: true;
  planKey: BillingGrantedRole;
  effectiveAt: number;
  providerUpdateStatus: 'applied' | 'pending';
}

export interface CancelPlatformSubscriptionRenewalResult {
  changed: boolean;
  renewalEnabled: false;
  providerCancellationStatus: 'completed' | 'pending' | 'not_configured';
  accessActive: boolean;
  accessEndsAt: number | null;
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
