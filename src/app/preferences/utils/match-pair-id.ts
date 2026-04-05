// src/app/preferences/utils/match-pair-id.ts
export function buildMatchPairId(uidA: string, uidB: string): string {
  const [a, b] = [uidA.trim(), uidB.trim()].sort();
  return `${a}__${b}`;
}