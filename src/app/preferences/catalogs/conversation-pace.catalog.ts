export const CONVERSATION_PACE_OPTIONS = [
  {
    code: 'talk_first',
    label: 'Conversar antes de combinar um encontro',
    shared: 'Vocês dois preferem conversar antes de combinar um encontro.',
    starter: 'Oi! Também gosto de conversar um pouco primeiro. Como foi seu dia?',
  },
  {
    code: 'take_it_slow',
    label: 'Conhecer aos poucos, sem pressa',
    shared: 'Vocês dois preferem se conhecer aos poucos.',
    starter: 'Oi! Que tal a gente se conhecer aos poucos? O que você gosta de fazer no tempo livre?',
  },
  {
    code: 'open_to_meeting',
    label: 'Aberto a combinar um encontro se houver sintonia',
    shared: 'Vocês dois estão abertos a combinar um encontro se houver sintonia.',
    starter: 'Oi! Qual seria um bom jeito de a gente se conhecer?',
  },
] as const;

export type ConversationPace = typeof CONVERSATION_PACE_OPTIONS[number]['code'];

export function resolveConversationPace(value: unknown) {
  return CONVERSATION_PACE_OPTIONS.find(({ code }) => code === value);
}
