// src/app/preferences/models/match-edge.model.ts
// Match real entre dois usuários após reciprocidade.
// pairId deve ser canônico e determinístico.
export type MatchSource =
  | 'mutual_like'
  | 'super_like'
  | 'discovery'
  | 'manual';

export interface MatchEdge {
  pairId: string;
  users: [string, string];

  createdAt: number;
  updatedAt: number;

  source: MatchSource;

  mutualScoreAtCreation: number;
  interactionOpened: boolean;

  chatId: string | null;
}