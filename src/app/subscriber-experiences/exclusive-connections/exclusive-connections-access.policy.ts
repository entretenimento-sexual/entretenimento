// src/app/subscriber-experiences/exclusive-connections/exclusive-connections-access.policy.ts
// -----------------------------------------------------------------------------
// EXCLUSIVE CONNECTIONS ACCESS POLICY
// -----------------------------------------------------------------------------
// Contratos da primeira experiência preparada para assinantes.
//
// A política de perfil é avaliada primeiro. Somente depois a página consulta o
// snapshot financeiro sanitizado, baseado no entitlement do backend.
// -----------------------------------------------------------------------------

import {
  ContentAccessPolicy,
  createSubscriberContentAccessPolicy,
} from 'src/app/core/access/content-access-policy.model';

export const EXCLUSIVE_CONNECTIONS_MINIMUM_ROLE = 'premium' as const;

export const EXCLUSIVE_CONNECTIONS_REQUIRED_PROFILE_FIELDS = [
  'gender',
  'orientation',
  'estado',
  'municipio',
] as const;

export const EXCLUSIVE_CONNECTIONS_PROFILE_ACCESS_POLICY:
  Readonly<ContentAccessPolicy> = Object.freeze({
    requiresCompletedProfile: true,
    requiresAdultAccess: true,
    blockRestrictedAccounts: true,
    requiredProfileFields: EXCLUSIVE_CONNECTIONS_REQUIRED_PROFILE_FIELDS,
  });

/**
 * Contrato completo para documentação e consumidores que precisem inspecionar
 * todos os requisitos declarativos da experiência.
 */
export const EXCLUSIVE_CONNECTIONS_ACCESS_POLICY =
  createSubscriberContentAccessPolicy(
    EXCLUSIVE_CONNECTIONS_MINIMUM_ROLE,
    EXCLUSIVE_CONNECTIONS_REQUIRED_PROFILE_FIELDS
  );
