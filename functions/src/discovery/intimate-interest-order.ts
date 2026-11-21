// Mesmo vocabulário aceito por validIntimateInterests nas Firestore Rules.
const INTEREST_KEYS = new Set([
  'vanilla', 'tantra', 'sensual_massage', 'bdsm', 'dom_sub', 'switching',
  'high_intensity', 'impact_play', 'discipline_protocols', 'sensory_deprivation',
  'bondage', 'shibari', 'sensory_play', 'textures',
  'eye_masks', 'roleplay', 'dirty_talk', 'voyeurism', 'exhibitionism',
  'foot_fetish', 'latex_leather', 'swing', 'menage', 'group_sex',
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function optedInIntimateInterests(profile: unknown): ReadonlySet<string> {
  const data = asRecord(profile);
  const visibility = asRecord(data?.['visibility']);
  if (visibility?.['useIntimateInterestsInSuggestions'] !== true) return new Set();

  const rules = asRecord(data?.['softRules']);
  const interests = asRecord(rules?.['intimateInterests']);
  const selected = [...INTEREST_KEYS].filter((key) =>
    interests?.[key] === 'explore' || interests?.[key] === 'familiar'
  );
  return new Set(selected);
}

/** Ordem da página inteira. Chaves, níveis e pontuação ficam no servidor. */
export function buildIntimateInterestOrder(
  viewerInterests: ReadonlySet<string>,
  candidateUids: readonly string[],
  candidateProfiles: ReadonlyMap<string, unknown>
): string[] | undefined {
  if (!viewerInterests.size) return undefined;

  const withAffinity: string[] = [];
  const remaining: string[] = [];
  for (const uid of candidateUids) {
    const interests = optedInIntimateInterests(candidateProfiles.get(uid));
    const shared = [...interests].some((interest) => viewerInterests.has(interest));
    (shared ? withAffinity : remaining).push(uid);
  }
  return withAffinity.length && remaining.length
    ? [...withAffinity, ...remaining]
    : undefined;
}
