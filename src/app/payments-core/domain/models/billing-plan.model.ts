//src\app\payments-core\domain\models\billing-plan.model.ts
export type PlatformPlanKey = 'basic' | 'premium' | 'vip';
export type BillingProvider = 'asaas' | 'pagarme' | 'mercadopago';
export type BillingScope =
  | 'platform_subscription'
  | 'creator_subscription'
  | 'tip'
  | 'paid_media'
  | 'paid_live';

export interface BillingPlan {
  id: string;
  key: PlatformPlanKey | string;
  scope: 'platform' | 'creator';
  title: string;
  description: string;
  amountCents: number;
  currency: 'BRL';
  interval?: 'month' | 'year';
  active: boolean;
  createdAt?: number;
  updatedAt?: number;
}