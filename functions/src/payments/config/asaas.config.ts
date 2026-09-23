// functions/src/payments/config/asaas.config.ts
// -----------------------------------------------------------------------------
// ASAAS CONFIG
// -----------------------------------------------------------------------------
// Segredos ficam no Firebase Secret Manager. Ambiente/API e URL pública do
// checkout são fronteiras separadas: webhook e reconciliação não dependem da
// disponibilidade/configuração da superfície web.
// -----------------------------------------------------------------------------

import { defineSecret } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';

import { isFunctionsEmulatorRuntime } from '../security/payment-runtime.guard';

export const ASAAS_API_KEY = defineSecret('ASAAS_API_KEY');
export const ASAAS_WEBHOOK_TOKEN = defineSecret('ASAAS_WEBHOOK_TOKEN');

export type AsaasEnvironment = 'sandbox' | 'production';

export interface AsaasApiRuntimeConfig {
  environment: AsaasEnvironment;
  apiBaseUrl: string;
  checkoutBaseUrl: string;
}

export interface AsaasRuntimeConfig extends AsaasApiRuntimeConfig {
  appBaseUrl: string;
}

export function resolveAsaasEnvironment(rawValue: unknown): AsaasEnvironment {
  const value = String(rawValue ?? '').trim().toLowerCase();

  if (value === 'sandbox' || value === 'production') {
    return value;
  }

  throw new HttpsError(
    'failed-precondition',
    'ASAAS_ENVIRONMENT precisa ser configurado como sandbox ou production.'
  );
}

export function assertAsaasApiKeyMatchesEnvironment(
  apiKey: string,
  environment: AsaasEnvironment
): void {
  const normalized = String(apiKey ?? '').trim();
  const expectedPrefix =
    environment === 'production' ? '$aact_prod_' : '$aact_hmlg_';

  if (!normalized || !normalized.startsWith(expectedPrefix)) {
    throw new HttpsError(
      'failed-precondition',
      'A chave Asaas não corresponde ao ambiente financeiro configurado.'
    );
  }
}

export function requireCloudAppBaseUrl(rawValue: unknown): string {
  const raw = String(rawValue ?? '').trim();
  if (!raw) {
    throw new HttpsError(
      'failed-precondition',
      'APP_BASE_URL não está configurada para o checkout real.'
    );
  }

  const url = new URL(raw);
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new HttpsError(
      'failed-precondition',
      'APP_BASE_URL do checkout real precisa usar HTTPS.'
    );
  }

  return url.origin;
}

export function assertAsaasRecurringCheckoutEnabled(): void {
  if (isFunctionsEmulatorRuntime()) return;

  if (String(process.env.ASAAS_RECURRING_ENABLED ?? '').trim() === 'true') {
    return;
  }

  throw new HttpsError(
    'failed-precondition',
    'A contratação recorrente real ainda não foi habilitada operacionalmente.',
    {
      reason: 'recurring_billing_not_enabled',
    }
  );
}

export function resolveAsaasApiRuntimeConfig(): AsaasApiRuntimeConfig {
  if (isFunctionsEmulatorRuntime()) {
    return {
      environment: 'sandbox',
      apiBaseUrl: 'https://api-sandbox.asaas.com/v3',
      checkoutBaseUrl: 'https://asaas.com/checkoutSession/show',
    };
  }

  const environment = resolveAsaasEnvironment(process.env.ASAAS_ENVIRONMENT);

  return {
    environment,
    apiBaseUrl:
      environment === 'production'
        ? 'https://api.asaas.com/v3'
        : 'https://api-sandbox.asaas.com/v3',
    checkoutBaseUrl: 'https://asaas.com/checkoutSession/show',
  };
}

export function resolveAsaasRuntimeConfig(): AsaasRuntimeConfig {
  const api = resolveAsaasApiRuntimeConfig();

  return {
    ...api,
    appBaseUrl: isFunctionsEmulatorRuntime()
      ? 'http://localhost:4200'
      : requireCloudAppBaseUrl(process.env.APP_BASE_URL),
  };
}
