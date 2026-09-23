// functions/src/payments/application/get-platform-plans.handler.ts
// -----------------------------------------------------------------------------
// GET PLATFORM PLANS HANDLER
// -----------------------------------------------------------------------------
// Catálogo público read-only usado pela UI. Preço/moeda/intervalo vêm da mesma
// fonte canônica que o checkout resolve novamente antes de criar qualquer sessão.
// -----------------------------------------------------------------------------

import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  listPlatformPlans,
  PLATFORM_BILLING_CATALOG_VERSION,
} from './billing-plan-catalog.service';

export const getPlatformPlans = onCall(
  { region: FUNCTIONS_REGION },
  async () => ({
    catalogVersion: PLATFORM_BILLING_CATALOG_VERSION,
    plans: listPlatformPlans().map((plan) => ({
      id: plan.id,
      key: plan.key,
      scope: plan.scope,
      title: plan.title,
      description: plan.description,
      amountCents: plan.amountCents,
      currency: plan.currency,
      interval: plan.interval,
      active: plan.active,
      catalogVersion: plan.catalogVersion,
    })),
  })
);
