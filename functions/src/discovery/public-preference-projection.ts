// functions/src/discovery/public-preference-projection.ts
// -----------------------------------------------------------------------------
// PROJEÇÃO PÚBLICA DE PREFERÊNCIAS
// -----------------------------------------------------------------------------
// Somente campos autorizados por showPreferenceBadges saem do documento privado.
// Preferências avançadas só são publicadas durante entitlement Básico+ vigente.
// A projeção não concede assinatura e não contém a política privada do viewer.
//
// Importante:
// - softRules.bodyPreferences descreve o que o usuário procura;
// - selfTraits.bodyTraits descreve características que ele declara sobre si;
// - discovery compara preferência do viewer com trait público do candidato.
// -----------------------------------------------------------------------------

export interface PublicPreferenceProjection {
  preferenceBadgesVisible: boolean;
  publicRelationshipIntents: readonly string[];
  publicSexualPractices: readonly string[];
  publicBodyTraits: readonly string[];
}

export interface PublicPreferenceProjectionOptions {
  canPublishAdvanced: boolean;
}

const RELATIONSHIP_INTENTS = new Set([
  'friendship', 'casual', 'dating', 'serious', 'open_relationship',
  'polyamory', 'swing', 'fetish_exploration',
]);

const SEXUAL_PRACTICES = new Set([
  'vanilla', 'bdsm', 'voyeurism', 'exhibitionism', 'swing', 'menage',
  'group_sex', 'roleplay', 'tantra', 'dom_sub', 'outdoor', 'fetishes',
  'edge_play', 'shibari', 'cuckold', 'pegging', 'sensory_play', 'dirty_talk',
]);

const BODY_TRAITS = new Set([
  'athletic', 'plus_size', 'tattoos', 'piercings', 'beard', 'long_hair',
  'curly_hair', 'light_eyes', 'muscular', 'slim', 'curvy',
]);

export function buildPublicPreferenceProjection(
  profile: Record<string, unknown> | null | undefined,
  options: PublicPreferenceProjectionOptions
): PublicPreferenceProjection {
  const visibility = asRecord(profile?.['visibility']);
  const softRules = asRecord(profile?.['softRules']);
  const hardRules = asRecord(profile?.['hardRules']);
  const selfTraits = asRecord(profile?.['selfTraits']);
  const visible = visibility?.['showPreferenceBadges'] === true;

  if (!visible) return emptyProjection(false);

  const relationshipIntents = sanitizeList(
    hardRules?.['acceptedRelationshipIntents'] ?? profile?.['relationshipIntents'],
    RELATIONSHIP_INTENTS,
    10
  );

  return {
    preferenceBadgesVisible: true,
    publicRelationshipIntents: relationshipIntents,
    publicSexualPractices: options.canPublishAdvanced
      ? sanitizeList(softRules?.['sexualPractices'], SEXUAL_PRACTICES, 40)
      : [],
    // Autodescrição é essencial e não depende de assinatura do candidato.
    publicBodyTraits: sanitizeList(selfTraits?.['bodyTraits'], BODY_TRAITS, 30),
  };
}

export function publicPreferenceProjectionMatches(
  current: Record<string, unknown>,
  expected: PublicPreferenceProjection
): boolean {
  return current['preferenceBadgesVisible'] === expected.preferenceBadgesVisible
    && sameStringArray(current['publicRelationshipIntents'], expected.publicRelationshipIntents)
    && sameStringArray(current['publicSexualPractices'], expected.publicSexualPractices)
    && sameStringArray(current['publicBodyTraits'], expected.publicBodyTraits);
}

function emptyProjection(visible: boolean): PublicPreferenceProjection {
  return {
    preferenceBadgesVisible: visible,
    publicRelationshipIntents: [],
    publicSexualPractices: [],
    publicBodyTraits: [],
  };
}

function sanitizeList(value: unknown, allowed: ReadonlySet<string>, maxItems: number): readonly string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => allowed.has(item))
  )).slice(0, maxItems);
}

function sameStringArray(current: unknown, expected: readonly string[]): boolean {
  return Array.isArray(current)
    && current.length === expected.length
    && current.every((value, index) => value === expected[index]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
