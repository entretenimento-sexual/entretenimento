export const INTIMATE_INTEREST_GROUPS = [
  {
    key: 'intimacy',
    label: 'Intimidade',
    options: [
      { key: 'vanilla', label: 'Sexo baunilha' },
      { key: 'tantra', label: 'Tantra' },
      { key: 'sensual_massage', label: 'Massagem sensual' },
    ],
  },
  {
    key: 'power',
    label: 'Dinâmicas de poder',
    options: [
      { key: 'bdsm', label: 'BDSM' },
      { key: 'dom_sub', label: 'Dominação e submissão' },
      { key: 'switching', label: 'Alternar papéis' },
      { key: 'high_intensity', label: 'Dinâmicas de alta intensidade' },
    ],
  },
  {
    key: 'bondage',
    label: 'Bondage e cordas',
    options: [
      { key: 'bondage', label: 'Bondage' },
      { key: 'shibari', label: 'Shibari' },
    ],
  },
  {
    key: 'sensations',
    label: 'Jogos sensoriais',
    options: [
      { key: 'sensory_play', label: 'Exploração sensorial' },
      { key: 'textures', label: 'Toque e texturas' },
      { key: 'eye_masks', label: 'Vendas e máscaras' },
    ],
  },
  {
    key: 'fantasies',
    label: 'Fantasias e fetiches',
    options: [
      { key: 'roleplay', label: 'Encenação de fantasias' },
      { key: 'dirty_talk', label: 'Conversa provocante' },
      { key: 'voyeurism', label: 'Voyeurismo consensual' },
      { key: 'exhibitionism', label: 'Exibicionismo consensual' },
      { key: 'foot_fetish', label: 'Fetiche por pés' },
      { key: 'latex_leather', label: 'Látex e couro' },
    ],
  },
  {
    key: 'shared',
    label: 'Experiências compartilhadas',
    options: [
      { key: 'swing', label: 'Swing' },
      { key: 'menage', label: 'Encontro a três' },
      { key: 'group_sex', label: 'Encontros em grupo' },
    ],
  },
] as const;

type IntimateInterestOption = typeof INTIMATE_INTEREST_GROUPS[number]['options'][number];
export type IntimateInterestLevel = 'explore' | 'familiar';
export type IntimateInterests = Partial<Record<IntimateInterestOption['key'], IntimateInterestLevel>>;

export const INTIMATE_INTEREST_OPTIONS = INTIMATE_INTEREST_GROUPS.flatMap(
  ({ options }): readonly IntimateInterestOption[] => options
);

export function normalizeIntimateInterests(value: unknown): IntimateInterests {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const input = value as Record<string, unknown>;
  const result: IntimateInterests = {};
  for (const { key } of INTIMATE_INTEREST_OPTIONS) {
    const level = input[key];
    if (level === 'explore' || level === 'familiar') result[key] = level;
  }
  return result;
}
