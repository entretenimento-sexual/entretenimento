//src\app\payments-core\domain\models\entitlement.model.ts
import { BillingScope } from './billing-plan.model';

export interface EntitlementDoc {
  id: string;
  buyerUid: string;
  sellerUid?: string;
  scope: BillingScope;
  resourceId?: string;
  planId?: string;
  active: boolean;
  startsAt: number;
  endsAt?: number | null;
  sourceCheckoutSessionId: string;
}
// uid não é canonico?