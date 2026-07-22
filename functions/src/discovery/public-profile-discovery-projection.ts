// functions/src/discovery/public-profile-discovery-projection.ts
// Comparação pura da projeção canônica de compatibilidade.
import type {
  CanonicalProfileDiscoveryFields,
} from './profile-discovery-normalization';

function sameStringArray(
  current: unknown,
  expected: readonly string[]
): boolean {
  if (!Array.isArray(current) || current.length !== expected.length) {
    return false;
  }

  return current.every((value, index) => value === expected[index]);
}

export function publicProfileDiscoveryProjectionMatches(
  current: Record<string, unknown>,
  expected: CanonicalProfileDiscoveryFields
): boolean {
  return (
    current['normalizedGender'] === expected.normalizedGender &&
    current['normalizedOrientation'] === expected.normalizedOrientation &&
    current['compatibilityReady'] === expected.compatibilityReady &&
    sameStringArray(
      current['interestedInGenders'],
      expected.interestedInGenders
    ) &&
    sameStringArray(
      current['interestedInOrientations'],
      expected.interestedInOrientations
    )
  );
}
