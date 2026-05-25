// functions/src/payments/application/get-platform-plan-by-key.handler.ts
// -----------------------------------------------------------------------------
// GET PLATFORM PLAN BY KEY HANDLER
// -----------------------------------------------------------------------------
//
// Consulta pública do catálogo de planos disponíveis para assinatura da
// plataforma.
//
// Responsabilidade:
// - devolver apenas planos ativos reconhecidos pelo backend;
// - reutilizar a mesma fonte usada na criação do checkout;
// - não expor informações sensíveis;
// - não confiar em preço enviado pelo cliente.
//
// Segurança:
// - o frontend pode consultar e exibir um plano;
// - o valor efetivamente cobrado continua sendo resolvido novamente no backend
//   durante a criação do checkout.

import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';

import {
  getPlatformPlanByKey as findPlatformPlanByKey,
} from './billing-plan-catalog.service';

interface GetPlatformPlanByKeyRequest {
  key?: string;
}

export const getPlatformPlanByKey = onCall<GetPlatformPlanByKeyRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    return findPlatformPlanByKey(request.data?.key);
  }
);