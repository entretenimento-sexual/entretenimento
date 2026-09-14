// functions/src/community/community-member-count.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER COUNT POLICY
// -----------------------------------------------------------------------------
// Métricas de membership são projeções derivadas. Ausência, null, strings ou
// números inválidos nunca podem ser convertidos implicitamente em zero/um.
// Toda transição que altera cardinalidade exige uma base confiável; caso
// contrário, a operação falha fechada e a transação não persiste o vínculo.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

export function normalizeCommunityMemberCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? Math.trunc(value)
    : null;
}

export function resolveCommunityMemberCountDelta(
  currentValue: unknown,
  delta: -1 | 1
): number {
  const current = normalizeCommunityMemberCount(currentValue);

  if (current === null || (delta === -1 && current === 0)) {
    throw new HttpsError(
      'data-loss',
      'A contagem de participantes da Comunidade está inconsistente.'
    );
  }

  return current + delta;
}
