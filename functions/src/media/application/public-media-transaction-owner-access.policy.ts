import { HttpsError } from 'firebase-functions/v2/https';
import {
  evaluateCanonicalOwnerLifecycle,
} from '../../account_lifecycle/public-owner-exposure.policy';

/**
 * Account lifecycle is authoritative for an owner even after a previously
 * issued playback/view token. Called inside metric-writing transactions.
 * Account age assurance is intentionally not consulted by Media.
 */
export function assertCurrentPublicMediaOwnerLifecycle(
  owner: Record<string, unknown> | null | undefined
): void {
  if (!evaluateCanonicalOwnerLifecycle(owner).allowed) {
    throw new HttpsError('not-found', 'Mídia pública não encontrada.');
  }
}
