// functions/src/community/community-purge-operations.authorization.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE OPERATIONS AUTHORIZATION
// -----------------------------------------------------------------------------
// Wrapper compatível do método existente. A autorização operacional canônica
// pertence a `community-operations.authorization.ts`.
// -----------------------------------------------------------------------------

import { hasCommunityOperationsPermission } from './community-operations.authorization';

export function hasCommunityPurgeOperationsPermission(value: unknown): boolean {
  return hasCommunityOperationsPermission(value, 'community:purge');
}
