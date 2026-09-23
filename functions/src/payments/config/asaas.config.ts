// functions/src/payments/config/asaas.config.ts
// -----------------------------------------------------------------------------
// ASAAS CONFIG
// -----------------------------------------------------------------------------
// Segredos ficam no Firebase Secret Manager. Ambiente e URL pública são
// configuração operacional não secreta e falham fechados quando inválidos.
// -----------------------------------------------------------------------------

import { defineSecret } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';

import { isFunctionsEmulatorRuntime } from '../../shared/runtime/functions-runtime.guard';

export const ASAAS_API_KEY = defineSecret('ASAAS_API_KEY');
export const ASAAS_WEBHOOK_TOKEN = defineSecret('ASAAS_WEBHOOK_TOKEN');

export type AsaasEnvironment = 'sandbox' | 'production';

export interface AsaasRuntimeConfig {
  environment: AsaasEnvironment;
  apiBaseUrl: string;
  checkoutBaseUrl: string;
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

export function resolveAsaasRuntimeConfig(): AsaasRuntimeConfig {
  if (isFunctionsEmulatorRuntime()) {
    return {
      environment: 'sandbox',
      apiBaseUrl: 'https://api-sandbox.asaas.com/v3',
      checkoutBaseUrl: 'https://asaas.com/checkoutSession/show',
      appBaseUrl: 'http://localhost:4200',
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
    appBaseUrl: requireCloudAppBaseUrl(process.env.APP_BASE_URL),
  };
}
