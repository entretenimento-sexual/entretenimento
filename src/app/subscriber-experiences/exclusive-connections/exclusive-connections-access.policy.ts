// src/app/subscriber-experiences/exclusive-connections/exclusive-connections-access.policy.ts
// -----------------------------------------------------------------------------
// EXCLUSIVE CONNECTIONS ACCESS POLICY
// -----------------------------------------------------------------------------
// Contrato da primeira experiência preparada para assinantes.
// Não substitui Rules, repositórios autorizados nem confirmação de pagamento.
// -----------------------------------------------------------------------------

import { createSubscriberContentAccessPolicy } from 'src/app/core/access/content-access-policy.model';

export const EXCLUSIVE_CONNECTIONS_ACCESS_POLICY =
  createSubscriberContentAccessPolicy('premium', [
    'gender',
    'orientation',
    'estado',
    'municipio',
  ]);
