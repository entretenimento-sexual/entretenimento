// functions/src/payments/application/recurring-contract-authority.policy.ts
// -----------------------------------------------------------------------------
// RECURRING CONTRACT AUTHORITY POLICY
// -----------------------------------------------------------------------------
// Contratos recorrentes são backend-only, mas qualquer ponteiro cruzado precisa
// revalidar o comprador antes de mutar estado financeiro.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

export function assertRecurringContractBuyer(
  rawBuyerUid: unknown,
  expectedBuyerUid: unknown
): void {
  const buyerUid = normalizeUid(rawBuyerUid);
  const expected = normalizeUid(expectedBuyerUid);

  if (buyerUid && expected && buyerUid === expected) return;

  throw new HttpsError(
    'data-loss',
    'O vínculo da assinatura recorrente está inconsistente.',
    {
      reason: 'recurring_contract_buyer_mismatch',
    }
  );
}
